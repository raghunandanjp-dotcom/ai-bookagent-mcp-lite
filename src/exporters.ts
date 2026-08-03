import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  TextRun
} from "docx";
import { createRequire } from "node:module";
import type { BookContent } from "./domain.ts";
import { fileDigest, safeOutputName, type ExportRecord } from "./project.ts";
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

function documentFont(language: BookContent["language"]): string {
  return language === "kn" ? "Noto Sans Kannada" : "Arial";
}

function sectionTitle(value: "poem" | "funFact" | "activity"): string {
  return value === "poem" ? "Poem" : value === "funFact" ? "Fun Fact" : "Activity";
}

function docxChildren(content: BookContent): Paragraph[] {
  const font = documentFont(content.language);
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1800, after: 360 },
      children: [new TextRun({ text: content.title, bold: true, size: 52, color: COLORS.navy, font })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 720 },
      children: [new TextRun({ text: "A creature poetry, facts, and activities book", size: 28, color: COLORS.teal, font })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${content.creatures.length} creatures`, size: 24, color: COLORS.ink, font })]
    })
  ];

  for (const [index, creature] of content.creatures.entries()) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      spacing: { after: 240 },
      children: [new TextRun({ text: `${index + 1}. ${creature.displayName}`, bold: true, color: COLORS.navy, font })]
    }));
    for (const key of ["poem", "funFact", "activity"] as const) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        keepNext: true,
        spacing: { before: 240, after: 100 },
        children: [new TextRun({ text: sectionTitle(key), bold: true, color: key === "funFact" ? COLORS.coral : COLORS.teal, font })]
      }));
      if (key === "poem") children.push(new Paragraph({ keepNext: true, children: [new TextRun({ text: creature.poem.title, bold: true, size: 30, color: COLORS.ink, font })] }));
      children.push(new Paragraph({
        spacing: { after: 200, line: 340 },
        children: [new TextRun({ text: key === "poem" ? normalizePoemText(creature.poem.text) : creature[key].text, size: 28, color: COLORS.ink, font })]
      }));
    }
    children.push(new Paragraph({
      spacing: { before: 240 },
      children: [new TextRun({ text: `Illustration idea: ${creature.illustrationBrief}`, italics: true, size: 22, color: "5C6770", font })]
    }));
  }
  if (content.closingNote) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: content.closingNote, size: 30, color: COLORS.navy, font })] }));
  }
  return children;
}

export async function exportDocx(content: BookContent, exportDir: string): Promise<ExportRecord> {
  await mkdir(exportDir, { recursive: true });
  const filename = `${safeOutputName(content.title)}.docx`;
  const outputPath = path.join(exportDir, filename);
  const document = new Document({
    creator: "AI Book Agent MCP Lite",
    title: content.title,
    description: "Children's creature poetry activity book",
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
  await writeFile(outputPath, await Packer.toBuffer(document));
  const digest = await fileDigest(outputPath);
  return { format: "docx", relativePath: filename, ...digest, createdAt: new Date().toISOString() };
}

export async function exportPptx(content: BookContent, exportDir: string): Promise<ExportRecord> {
  await mkdir(exportDir, { recursive: true });
  const filename = `${safeOutputName(content.title)}.pptx`;
  const outputPath = path.join(exportDir, filename);
  const pptx = new PptxGenJS();
  const font = documentFont(content.language);
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
  cover.addText(content.title, { x: 0.8, y: 2.2, w: 11.7, h: 1, fontSize: 34, bold: true, align: "center", color: COLORS.navy, margin: 0.05 });
  cover.addText(`${content.creatures.length} wonderful creatures`, { x: 1.5, y: 3.45, w: 10.3, h: 0.5, fontSize: 20, align: "center", color: COLORS.teal, margin: 0.02 });

  for (const creature of content.creatures) {
    for (const key of ["poem", "funFact", "activity"] as const) {
      const slide = pptx.addSlide();
      slide.background = { color: COLORS.cream };
      slide.addText(creature.displayName, { x: 0.7, y: 0.45, w: 11.9, h: 0.55, fontSize: 28, bold: true, color: COLORS.navy, margin: 0.03 });
      slide.addText(sectionTitle(key), { x: 0.72, y: 1.15, w: 3.0, h: 0.4, fontSize: 18, bold: true, color: key === "funFact" ? COLORS.coral : COLORS.teal, margin: 0.02 });
      const body = key === "poem" ? `${creature.poem.title}\n\n${normalizePoemText(creature.poem.text)}` : creature[key].text;
      slide.addText(body, { x: 0.8, y: 1.8, w: 7.3, h: 4.5, fontSize: 20, color: COLORS.ink, breakLine: false, valign: "middle", margin: 0.12, fit: "shrink" });
      slide.addText(creature.altText, { x: 8.55, y: 2.0, w: 3.9, h: 2.8, fontSize: 16, italic: true, color: "5C6770", align: "center", valign: "middle", margin: 0.15, fill: { color: "E9F3F5" }, line: { color: "9BC8D1", width: 1 } });
      slide.addText("Illustration placeholder", { x: 8.8, y: 5.05, w: 3.4, h: 0.35, fontSize: 12, color: "68737D", align: "center", margin: 0.01 });
    }
  }
  await pptx.writeFile({ fileName: outputPath });
  const digest = await fileDigest(outputPath);
  return { format: "pptx", relativePath: filename, ...digest, createdAt: new Date().toISOString() };
}

export async function exportPdf(content: BookContent, exportDir: string): Promise<ExportRecord> {
  const { default: PDFDocument } = await import("pdfkit");
  await mkdir(exportDir, { recursive: true });
  const filename = `${safeOutputName(content.title)}.pdf`;
  const outputPath = path.join(exportDir, filename);
  await new Promise<void>((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margins: { top: 56, right: 56, bottom: 56, left: 56 }, info: { Title: content.title, Author: "AI Book Agent MCP Lite" } });
    if (content.language === "kn") {
      const fontPath = process.env.BOOK_AGENT_KANNADA_FONT_PATH;
      if (!fontPath) {
        reject(new Error("Kannada PDF export requires BOOK_AGENT_KANNADA_FONT_PATH to point to a Kannada-capable TTF font."));
        return;
      }
      pdf.registerFont("BookFont", fontPath);
      pdf.font("BookFont");
    }
    const stream = createWriteStream(outputPath, { flags: "w" });
    stream.on("finish", resolve);
    stream.on("error", reject);
    pdf.on("error", reject);
    pdf.pipe(stream);
    pdf.fillColor(`#${COLORS.navy}`).fontSize(30).text(content.title, { align: "center" });
    pdf.moveDown().fillColor(`#${COLORS.teal}`).fontSize(16).text(`${content.creatures.length} wonderful creatures`, { align: "center" });
    for (const creature of content.creatures) {
      pdf.addPage();
      pdf.fillColor(`#${COLORS.navy}`).fontSize(24).text(creature.displayName);
      for (const key of ["poem", "funFact", "activity"] as const) {
        pdf.moveDown(0.8).fillColor(`#${key === "funFact" ? COLORS.coral : COLORS.teal}`).fontSize(16).text(sectionTitle(key));
        const body = key === "poem" ? `${creature.poem.title}\n\n${normalizePoemText(creature.poem.text)}` : creature[key].text;
        pdf.moveDown(0.25).fillColor(`#${COLORS.ink}`).fontSize(14).text(body, { lineGap: 4 });
      }
      pdf.moveDown().fillColor("#5C6770").fontSize(11).text(`Illustration idea: ${creature.illustrationBrief}`);
    }
    pdf.end();
  });
  const digest = await fileDigest(outputPath);
  return { format: "pdf", relativePath: filename, ...digest, createdAt: new Date().toISOString() };
}

export async function exportSelectedFormats(
  content: BookContent,
  exportDir: string,
  formats: Array<"docx" | "pptx" | "pdf">
): Promise<ExportRecord[]> {
  const unique = Array.from(new Set(["docx" as const, ...formats]));
  const records: ExportRecord[] = [];
  for (const format of unique) {
    if (format === "docx") records.push(await exportDocx(content, exportDir));
    if (format === "pptx") records.push(await exportPptx(content, exportDir));
    if (format === "pdf") records.push(await exportPdf(content, exportDir));
  }
  return records;
}
