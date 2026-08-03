import { createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
  type IRunOptions
} from "docx";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { createRequire } from "node:module";
import { DOCX_TYPOGRAPHY_BY_AGE, PPTX_AGE_PROFILES, type BookContent, type BookRequest } from "./domain.ts";
import { fileDigest, safeOutputName, type ExportFailure, type ExportRecord } from "./project.ts";
import { normalizePoemText } from "./poems.ts";

const require = createRequire(import.meta.url);
const PptxGenJS = require("pptxgenjs") as typeof import("pptxgenjs").default;
const COLORS = {
  navy: "17324D",
  teal: "147D92",
  coral: "E76F51",
  cream: "FFF9ED",
  ink: "263238"
};

const PDF = {
  margin: 56,
  footerHeight: 24,
  maxBytes: 25 * 1024 * 1024,
  bodyFontSize: 13,
  bodyLineGap: 5
} as const;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const englishRegularFont = path.resolve(moduleDir, "../assets/fonts/NotoSans-Regular.ttf");
const englishBoldFont = path.resolve(moduleDir, "../assets/fonts/NotoSans-Bold.ttf");

export class PdfExportError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PdfExportError";
  }
}

function documentFont(language: BookContent["language"]): string {
  return language === "kn" ? "Noto Sans Kannada" : "Arial";
}

function documentLanguage(language: BookContent["language"]): string {
  return language === "kn" ? "kn-IN" : "en-US";
}

function sectionTitle(value: "poem" | "funFact" | "activity"): string {
  return value === "poem" ? "Poem" : value === "funFact" ? "Fun Fact" : "Activity";
}

function run(text: string, content: BookContent, options: Omit<IRunOptions, "text"> = {}): TextRun {
  return new TextRun({ text, font: documentFont(content.language), ...options });
}

function pageHeading(content: BookContent, creatureName: string, section: string): Paragraph[] {
  return [
    new Paragraph({
      pageBreakBefore: true,
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      spacing: { after: 100 },
      children: [run(creatureName, content, { bold: true, size: 48, color: COLORS.navy })]
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      keepNext: true,
      spacing: { after: 180 },
      children: [run(section, content, { bold: true, size: 36, color: section === "Fun Fact" ? COLORS.coral : COLORS.teal })]
    })
  ];
}

function illustrationPlaceholder(content: BookContent, brief: string, altText: string): Paragraph {
  const border = { style: BorderStyle.SINGLE, size: 8, color: "9BC8D1", space: 8 };
  return new Paragraph({
    spacing: { before: 300, after: 120, line: 280 },
    border: { top: border, right: border, bottom: border, left: border },
    shading: { type: ShadingType.CLEAR, fill: "E9F3F5", color: "auto" },
    children: [
      run("Illustration placeholder", content, { bold: true, size: 24, color: COLORS.teal }),
      run(`\nIllustration direction: ${brief}`, content, { size: 22, color: "42525C" }),
      run(`\nAccessible description: ${altText}`, content, { size: 22, color: COLORS.ink })
    ]
  });
}

function poemParagraphs(content: BookContent, text: string): Paragraph[] {
  const typography = DOCX_TYPOGRAPHY_BY_AGE[content.effectiveAgeBand];
  return normalizePoemText(text).split("\n").map((line) => new Paragraph({
    keepLines: true,
    spacing: { after: line ? 0 : Math.round(typography.poemPoints * 10), line: Math.round(typography.poemPoints * typography.lineSpacing * 20) },
    children: line ? [run(line, content, { size: typography.poemPoints * 2, color: COLORS.ink })] : []
  }));
}

function bodyParagraph(content: BookContent, text: string): Paragraph {
  const typography = DOCX_TYPOGRAPHY_BY_AGE[content.effectiveAgeBand];
  return new Paragraph({
    spacing: { after: 180, line: Math.round(typography.bodyPoints * typography.lineSpacing * 20) },
    children: [run(text, content, { size: typography.bodyPoints * 2, color: COLORS.ink })]
  });
}

function reviewNotice(content: BookContent, status: BookContent["creatures"][number]["poem"]["reviewStatus"]): Paragraph[] {
  if (status !== "needs_review" && content.language !== "kn") return [];
  const message = content.language === "kn"
    ? "Review required: experimental Kannada language and rendering."
    : "Review required before publication.";
  return [new Paragraph({ spacing: { before: 160, after: 80 }, children: [run(message, content, { italics: true, size: 20, color: "5C6770" })] })];
}

function docxChildren(content: BookContent): Paragraph[] {
  const font = documentFont(content.language);
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1800, after: 360 },
      children: [new TextRun({ text: content.title, bold: true, size: 56, color: COLORS.navy, font })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 720 },
      children: [new TextRun({ text: "A creature poetry, facts, and activities book", size: 28, color: COLORS.teal, font })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Ages ${content.effectiveAgeBand} · ${content.language === "kn" ? "Kannada (experimental)" : "English"} · ${content.creatures.length} creatures`, size: 24, color: COLORS.ink, font })]
    })
  ];

  for (const creature of content.creatures) {
    children.push(...pageHeading(content, creature.displayName, "Poem"));
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_3,
      keepNext: true,
      spacing: { after: 160 },
      children: [run(creature.poem.title, content, { bold: true, size: 32, color: COLORS.ink })]
    }));
    children.push(...poemParagraphs(content, creature.poem.text));
    children.push(...reviewNotice(content, creature.poem.reviewStatus));
    children.push(illustrationPlaceholder(content, creature.illustrationBrief, creature.altText));

    children.push(...pageHeading(content, creature.displayName, "Fun Fact"));
    children.push(bodyParagraph(content, creature.funFact.text));
    children.push(...reviewNotice(content, creature.funFact.reviewStatus));
    children.push(illustrationPlaceholder(content, creature.illustrationBrief, creature.altText));

    children.push(...pageHeading(content, creature.displayName, "Activity"));
    children.push(bodyParagraph(content, creature.activity.text));
    children.push(...reviewNotice(content, creature.activity.reviewStatus));
    children.push(illustrationPlaceholder(content, creature.illustrationBrief, creature.altText));
  }
  if (content.closingNote) {
    children.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [run("A final note", content, { bold: true, size: 48, color: COLORS.navy })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: content.closingNote, size: 30, color: COLORS.navy, font })] }));
  }
  return children;
}

export async function exportDocx(content: BookContent, exportDir: string): Promise<ExportRecord> {
  await mkdir(exportDir, { recursive: true });
  const filename = `${safeOutputName(content.title)}.docx`;
  const outputPath = path.join(exportDir, filename);
  const temporaryPath = path.join(exportDir, `.${filename}.${randomUUID()}.tmp`);
  const language = documentLanguage(content.language);
  const document = new Document({
    creator: "AI Book Agent MCP Lite",
    title: content.title,
    subject: "Children's creature poetry activity book",
    keywords: "children, poetry, creatures, activities",
    description: `Children's creature poetry activity book for ages ${content.effectiveAgeBand}; ${language}; ${content.creatures.length} creatures`,
    styles: {
      default: {
        document: { run: { font: documentFont(content.language), language: { value: language } } }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }
        }
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: ["Page ", PageNumber.CURRENT], size: 18, color: "68737D", font: "Arial" })]
          })]
        })
      },
      children: docxChildren(content)
    }]
  });
  try {
    let buffer = await Packer.toBuffer(document);
    const packageContents = await JSZip.loadAsync(buffer);
    if (!packageContents.file("[Content_Types].xml") || !packageContents.file("word/document.xml") || !packageContents.file("docProps/core.xml")) {
      throw new Error("Generated DOCX package is missing a required OOXML part.");
    }
    const coreProperties = await packageContents.file("docProps/core.xml")!.async("string");
    packageContents.file("docProps/core.xml", coreProperties.replace("</cp:coreProperties>", `<dc:language>${language}</dc:language></cp:coreProperties>`));
    buffer = await packageContents.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await writeFile(temporaryPath, buffer, { flag: "wx" });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  const digest = await fileDigest(outputPath);
  return { format: "docx", relativePath: filename, ...digest, createdAt: new Date().toISOString() };
}

export async function exportPptx(
  content: BookContent,
  exportDir: string,
  context: Pick<BookRequest, "ageBand" | "language"> = { ageBand: content.effectiveAgeBand, language: content.language }
): Promise<ExportRecord> {
  await mkdir(exportDir, { recursive: true });
  const filename = `${safeOutputName(content.title)}.pptx`;
  const outputPath = path.join(exportDir, filename);
  const pptx = new PptxGenJS();
  const font = documentFont(content.language);
  const languageTag = documentLanguage(content.language);
  const profile = PPTX_AGE_PROFILES[context.ageBand];
  const bodyFontSize = profile.bodyFontSize + (content.language === "kn" ? 1 : 0);
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "AI Book Agent MCP Lite";
  pptx.subject = "Children's creature poetry activity book";
  pptx.title = content.title;
  pptx.company = "";
 
  pptx.theme = {
    headFontFace: font,
    bodyFontFace: font,
  };

  const cover = pptx.addSlide();
  cover.background = { color: COLORS.cream };
  cover.addText(content.title, { x: 0.8, y: 2.1, w: 11.7, h: 1.15, fontFace: font, fontSize: 52, lang: languageTag, bold: true, align: "center", color: COLORS.navy, margin: 0.05 });
  cover.addText(`${content.creatures.length} wonderful creatures`, { x: 1.5, y: 3.45, w: 10.3, h: 0.5, fontFace: font, fontSize: 20, lang: languageTag, align: "center", color: COLORS.teal, margin: 0.02 });
  if (content.closingNote) cover.addText(content.closingNote, { x: 1.2, y: 6.45, w: 10.9, h: 0.45, fontFace: font, fontSize: 16, lang: languageTag, align: "center", color: "5C6770", margin: 0.02 });

  let slideNumber = 1;
  for (const creature of content.creatures) {
    for (const key of ["poem", "funFact", "activity"] as const) {
      const slide = pptx.addSlide();
      slideNumber += 1;
      slide.background = { color: COLORS.cream };
      slide.addText(creature.displayName, { x: 0.7, y: 0.42, w: 11.9, h: 0.65, fontFace: font, fontSize: profile.creatureTitleFontSize, lang: languageTag, bold: true, color: COLORS.navy, margin: 0.03 });
      slide.addText(sectionTitle(key), { x: 0.72, y: 1.17, w: 3.0, h: 0.45, fontFace: font, fontSize: profile.sectionTitleFontSize, lang: languageTag, bold: true, color: key === "funFact" ? COLORS.coral : COLORS.teal, margin: 0.02 });
      const body = key === "poem" ? `${creature.poem.title}\n\n${normalizePoemText(creature.poem.text)}` : creature[key].text;
      slide.addText(body, { x: 0.8, y: 1.8, w: 7.3, h: 4.7, fontFace: font, fontSize: bodyFontSize, lang: languageTag, color: COLORS.ink, breakLine: false, valign: "middle", margin: 0.12 });
      slide.addText(`Illustration brief:\n${creature.illustrationBrief}\n\nAlternative text:\n${creature.altText}`, { x: 8.55, y: 1.8, w: 3.9, h: 3.55, fontFace: font, fontSize: 16, lang: languageTag, color: "35434D", align: "left", valign: "middle", margin: 0.18, fill: { color: "E9F3F5" }, line: { color: "6B9FAA", width: 1.5 } });
      slide.addText("Illustration placeholder", { x: 8.8, y: 5.05, w: 3.4, h: 0.35, fontFace: font, fontSize: 12, lang: languageTag, color: "68737D", align: "center", margin: 0.01 });
      slide.addText(String(slideNumber), { x: 12.25, y: 7.02, w: 0.35, h: 0.2, fontFace: font, fontSize: 10, lang: languageTag, color: "68737D", align: "right", margin: 0 });
    }
  }
  await pptx.writeFile({ fileName: outputPath });
  const digest = await fileDigest(outputPath);
  return { format: "pptx", relativePath: filename, ...digest, createdAt: new Date().toISOString(), ...(content.language === "kn" ? { warnings: ["Kannada PPTX output requires Noto Sans Kannada on viewing and editing systems; the font is not embedded."] } : {}) };
}

export async function exportPdf(content: BookContent, exportDir: string): Promise<ExportRecord> {
  const { default: PDFDocument } = await import("pdfkit");
  await mkdir(exportDir, { recursive: true });
  const filename = `${safeOutputName(content.title)}.pdf`;
  const outputPath = path.join(exportDir, filename);
  const temporaryPath = `${outputPath}.tmp`;
  const regularFont = content.language === "kn" ? process.env.BOOK_AGENT_KANNADA_FONT_PATH : englishRegularFont;
  const boldFont = content.language === "kn" ? regularFont : englishBoldFont;
  if (!regularFont) throw new PdfExportError("pdf_font_missing", "Kannada PDF export requires BOOK_AGENT_KANNADA_FONT_PATH to point to a Kannada-capable TTF font.");
  try {
    await access(regularFont);
    await access(boldFont!);
  } catch {
    throw new PdfExportError("pdf_font_missing", `PDF font is not readable: ${regularFont}`);
  }
  await rm(temporaryPath, { force: true });
  try {
    await new Promise<void>((resolve, reject) => {
    const pdf = new PDFDocument({
      size: "A4",
      autoFirstPage: false,
      margins: { top: PDF.margin, right: PDF.margin, bottom: PDF.margin, left: PDF.margin },
      info: { Title: content.title, Author: "AI Book Agent MCP Lite", Subject: "Children's creature poetry activity book", Creator: "AI Book Agent MCP Lite" }
    });
    try {
      pdf.registerFont("BookRegular", regularFont);
      pdf.registerFont("BookBold", boldFont!);
      pdf.font("BookRegular");
      if (content.language === "kn") {
        const usedText = [content.title, ...content.creatures.flatMap((creature) => [creature.displayName, creature.poem.title, creature.poem.text, creature.funFact.text, creature.activity.text, creature.illustrationBrief])].join("\n");
        const internalFont = (pdf as unknown as { _font?: { font?: { layout(value: string): { glyphs: Array<{ id: number }> } } } })._font?.font;
        if (internalFont?.layout(usedText).glyphs.some((glyph) => glyph.id === 0)) throw new PdfExportError("pdf_glyph_missing", "The configured Kannada font does not cover every character used by this book.");
      }
    } catch (error) {
      reject(error instanceof PdfExportError ? error : new PdfExportError("pdf_font_invalid", `PDF font could not be loaded: ${String(error)}`));
      return;
    }
    const stream = createWriteStream(temporaryPath, { flags: "wx" });
    stream.on("finish", resolve);
    stream.on("error", reject);
    pdf.on("error", reject);
    pdf.pipe(stream);
    const totalPages = 1 + content.creatures.length * 3;
    const addPage = (pageNumber: number, creatureName?: string, section?: string) => {
      pdf.addPage();
      if (creatureName && section) {
        pdf.font("BookRegular").fillColor("#68737D").fontSize(10).text(`${creatureName} · ${section}`, PDF.margin, 30, { width: pdf.page.width - 2 * PDF.margin });
      }
      pdf.font("BookRegular").fillColor("#68737D").fontSize(9).text(`${content.title} · Page ${pageNumber} of ${totalPages}`, PDF.margin, pdf.page.height - PDF.margin - 12, { width: pdf.page.width - 2 * PDF.margin, height: 12, align: "center", lineBreak: false });
    };
    addPage(1);
    pdf.font("BookBold").fillColor(`#${COLORS.navy}`).fontSize(30).text(content.title, PDF.margin, 220, { width: pdf.page.width - 2 * PDF.margin, align: "center" });
    pdf.moveDown().font("BookRegular").fillColor(`#${COLORS.teal}`).fontSize(16).text(`${content.creatures.length} wonderful creatures`, { align: "center" });
    let pageNumber = 1;
    for (const creature of content.creatures) {
      for (const key of ["poem", "funFact", "activity"] as const) {
        pageNumber += 1;
        const label = sectionTitle(key);
        addPage(pageNumber, creature.displayName, label);
        pdf.font("BookBold").fillColor(`#${COLORS.navy}`).fontSize(24).text(creature.displayName, PDF.margin, 64, { width: pdf.page.width - 2 * PDF.margin });
        pdf.moveDown(0.45).fillColor(`#${key === "funFact" ? COLORS.coral : COLORS.teal}`).fontSize(16).text(label);
        if (key === "poem") pdf.moveDown(0.25).font("BookBold").fillColor(`#${COLORS.ink}`).fontSize(15).text(creature.poem.title);
        const body = key === "poem" ? normalizePoemText(creature.poem.text) : creature[key].text;
        const bodyY = pdf.y + 10;
        const bodyWidth = pdf.page.width - 2 * PDF.margin;
        const illustrationHeight = key === "activity" ? 76 : 0;
        const availableHeight = pdf.page.height - PDF.margin - PDF.footerHeight - bodyY - illustrationHeight;
        pdf.font("BookRegular").fontSize(PDF.bodyFontSize);
        const measuredHeight = pdf.heightOfString(body, { width: bodyWidth, lineGap: PDF.bodyLineGap });
        if (measuredHeight > availableHeight) {
          reject(new PdfExportError("pdf_text_overflow", `${creature.creatureId}.${key} requires ${Math.ceil(measuredHeight)}pt but only ${Math.floor(availableHeight)}pt is available.`));
          return;
        }
        pdf.fillColor(`#${COLORS.ink}`).text(body, PDF.margin, bodyY, { width: bodyWidth, height: availableHeight, lineGap: PDF.bodyLineGap });
        if (key === "activity") {
          pdf.font("BookRegular").fillColor("#5C6770").fontSize(10).text(`Illustration idea: ${creature.illustrationBrief}\nAlt text: ${creature.altText}`, PDF.margin, pdf.page.height - PDF.margin - PDF.footerHeight - 58, { width: bodyWidth, height: 58 });
        }
      }
    }
    pdf.end();
    });
    const details = await stat(temporaryPath);
    if (details.size > PDF.maxBytes) throw new PdfExportError("pdf_file_too_large", "PDF exceeds the 25 MiB MVP size limit.");
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  const digest = await fileDigest(outputPath);
  return { format: "pdf", relativePath: filename, ...digest, createdAt: new Date().toISOString() };
}

export async function exportSelectedFormats(
  content: BookContent,
  exportDir: string,
  formats: Array<"docx" | "pptx" | "pdf">,
  context: Pick<BookRequest, "ageBand" | "language"> = { ageBand: content.effectiveAgeBand, language: content.language }
): Promise<{ records: ExportRecord[]; failures: ExportFailure[] }> {
  const unique = Array.from(new Set(["docx" as const, ...formats]));
  const records: ExportRecord[] = [];
  const failures: ExportFailure[] = [];
  for (const format of unique) {
    try {
      if (format === "docx") records.push(await exportDocx(content, exportDir));
      if (format === "pptx") records.push(await exportPptx(content, exportDir, context));
      if (format === "pdf") records.push(await exportPdf(content, exportDir));
    } catch (error) {
      failures.push({ format, code: error instanceof PdfExportError ? error.code : `${format}_export_failed`, message: error instanceof Error ? error.message : String(error) });
      if (format === "docx") break;
    }
  }
  return { records, failures };
}
