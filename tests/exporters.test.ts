import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { BookContent } from "../src/domain.ts";
import { exportDocx, exportPdf, exportSelectedFormats, hasMissingPrintableGlyph } from "../src/exporters.ts";
import { fixtureIllustrations } from "./fixtures/illustrations.ts";

const { renameMock } = vi.hoisted(() => ({ renameMock: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  renameMock.mockImplementation(actual.rename);
  return { ...actual, rename: renameMock };
});

const content: BookContent = {
  schemaVersion: "1.1",
  title: "Ocean Friends",
  language: "en",
  selectedAgeBand: "6-8",
  effectiveAgeBand: "6-8",
  generationAttempt: 0,
  creatures: [{
    creatureId: "octopus",
    displayName: "Octopus",
    poem: {
      title: "Waving Arms",
      text: "First line\r\nSecond line\r\nThird line\r\n\r\nFourth line\r\nFifth line\r\nSixth line",
      language: "en",
      reviewStatus: "human_reviewed",
      structureVersion: "1.0",
      rhymeScheme: "AAB"
    },
    funFact: { text: "An octopus has three hearts.", language: "en", reviewStatus: "source_supported" },
    activity: { text: "Draw and count eight arms.", language: "en", reviewStatus: "needs_review" },
    illustrationBrief: "A friendly octopus near coral.",
    altText: "A smiling octopus with eight visible arms."
  }],
  closingNote: "Keep wondering about ocean life!"
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.mocked(rename).mockClear();
});

async function documentParts(book = content) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-docx-"));
  temporaryDirectories.push(directory);
  const { set } = await fixtureIllustrations(directory, book.creatures.map((creature) => creature.creatureId));
  const record = await exportDocx(book, directory, set);
  const data = await readFile(path.join(directory, record.relativePath));
  const zip = await JSZip.loadAsync(data);
  const part = async (name: string) => zip.file(name)?.async("string") ?? "";
  return {
    record,
    data,
    zip,
    document: await part("word/document.xml"),
    footer: await part("word/footer1.xml"),
    styles: await part("word/styles.xml"),
    core: await part("docProps/core.xml")
  };
}

describe("DOCX exporter", () => {
  it("embeds approved artwork with accessibility metadata and no production labels", async () => {
    const result = await documentParts();

    expect(result.record.bytes).toBe(result.data.byteLength);
    expect(result.document.match(/<w:pageBreakBefore\/>/g)).toHaveLength(4);
    expect(result.document).toContain('<w:pgSz w:w="11906" w:h="16838"');
    expect(result.document).toContain('<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"');
    expect(result.document.match(/<w:drawing>/g)).toHaveLength(4);
    expect(result.document).toContain('descr="A colorful scene introducing the creatures."');
    expect(result.document).toContain('descr="octopus in a colorful habitat."');
    expect(result.document).not.toMatch(/Illustration (?:placeholder|brief|direction|idea)|Accessible description:|Alternative text:/iu);
    expect(result.document).toContain("Review required before publication.");
    expect(result.document).toContain("Waving Arms");
    for (const line of ["First line", "Second line", "Third line", "Fourth line", "Fifth line", "Sixth line"]) {
      expect(result.document).toContain(line);
    }
    expect(result.document).toContain('<w:pStyle w:val="Heading1"/>');
    expect(result.document).toContain('<w:pStyle w:val="Heading2"/>');
    expect(result.document).toContain('<w:pStyle w:val="Heading3"/>');
    expect(result.document).toContain('<w:sz w:val="40"/>');
    expect(result.styles).toContain('<w:lang w:val="en-US"/>');
    expect(result.core).toContain("Ocean Friends");
    expect(result.core).toContain("children, poetry, creatures, activities");
    expect(result.core).toContain("<dc:language>en-US</dc:language>");
    expect(result.core).toContain("ages 6-8; en-US; 1 creatures");
    expect(`${result.document}${result.styles}${result.core}`).not.toMatch(/[A-Z]:\\Users\\/i);
    const media = Object.entries(result.zip.files).filter(([name, entry]) => name.startsWith("word/media/") && !entry.dir);
    expect(media).toHaveLength(2);
    const digests = await Promise.all(media.map(async ([, entry]) => createHash("sha256").update(await entry.async("nodebuffer")).digest("hex")));
    expect(new Set(digests).size).toBe(2);
  });

  it("uses a Kannada complex-script font for editable DOCX without affecting English defaults", async () => {
    const kannada = structuredClone(content);
    kannada.language = "kn";
    kannada.title = "ಸಾಗರ ಸ್ನೇಹಿತರು";
    kannada.creatures[0]!.displayName = "ಆಕ್ಟೋಪಸ್";
    for (const section of [kannada.creatures[0]!.poem, kannada.creatures[0]!.funFact, kannada.creatures[0]!.activity]) section.language = "kn";
    kannada.creatures[0]!.poem.text = "ಅಲೆ ಹಾಡು ಒಂದು\nಅಲೆ ಹಾಡು ಎರಡು\nಅಲೆ ಹಾಡು ಮೂರು\n\nಸಾಗರ ಗೀತೆ ಒಂದು\nಸಾಗರ ಗೀತೆ ಎರಡು\nಸಾಗರ ಗೀತೆ ಮೂರು";
    const result = await documentParts(kannada);

    expect(result.styles).toContain("Nirmala UI");
    expect(result.document).toContain('w:cs="Nirmala UI"');
    expect(result.document).toContain('w:hint="cs"');
    expect(result.document).toContain('w:bidi="kn-IN"');
    expect(`${result.document}${result.styles}`).not.toContain("Noto Sans Kannada");
    expect(result.styles).toContain('w:lang w:val="kn-IN" w:bidi="kn-IN"');
    expect(result.document).toContain("ಸಾಗರ ಸ್ನೇಹಿತರು");
  });

  it("pins complex-script font selection for the elephant, tiger, and peacock review trio", async () => {
    const kannada = structuredClone(content);
    kannada.language = "kn";
    kannada.title = "ಕಾಡಿನ ಗೆಳೆಯರು";
    kannada.creatures = [
      ["elephant", "ಆನೆ", "ಆನೆಯ ಸೊಂಡಿಲು ನೀರಲಿ ಆಟ", "ಆನೆಯ ಹೆಜ್ಜೆ ಮಣ್ಣಲಿ ಹಾಡು"],
      ["tiger", "ಹುಲಿ", "ಹುಲಿಯ ಹೆಜ್ಜೆ ಕಾಡಲಿ ಸದ್ದು", "ಹುಲಿಯ ಪಟ್ಟೆ ಬಿಸಿಲಲಿ ಹೊಳುಕು"],
      ["peacock", "ನವಿಲು", "ನವಿಲು ಗರಿಗಳ ಬಣ್ಣದ ಆಟ", "ನವಿಲು ಮಳೆಯಲಿ ಕುಣಿಯುವ ಹಾಡು"]
    ].map(([creatureId, displayName, firstLine, secondLine]) => ({
      ...structuredClone(content.creatures[0]!),
      creatureId,
      displayName,
      poem: {
        ...structuredClone(content.creatures[0]!.poem),
        title: `${displayName} ಹಾಡು`,
        text: `${firstLine}\n${secondLine}\n${firstLine}\n\n${secondLine}\n${firstLine}\n${secondLine}`,
        language: "kn" as const
      },
      funFact: { ...content.creatures[0]!.funFact, text: firstLine, language: "kn" as const },
      activity: { ...content.creatures[0]!.activity, text: secondLine, language: "kn" as const }
    }));
    const result = await documentParts(kannada);

    for (const name of ["ಆನೆ", "ಹುಲಿ", "ನವಿಲು"]) expect(result.document).toContain(name);
    expect(result.document.match(/w:hint="cs"/g)?.length).toBeGreaterThan(20);
    expect(result.document.match(/w:bidi="kn-IN"/g)?.length).toBeGreaterThan(20);
  });

  it("keeps the complete page label outside a cached PAGE field for odd and even two-digit pages", async () => {
    const result = await documentParts();

    expect(result.footer).toContain('<w:r><w:rPr>');
    expect(result.footer).toContain('<w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr="PAGE">');
    expect(result.footer).toContain('<w:fldSimple w:instr="PAGE"><w:r><w:t xml:space="preserve">1</w:t></w:r></w:fldSimple>');
    expect(result.footer).not.toContain('<w:fldChar w:fldCharType="begin"/>');
    expect(result.footer).not.toContain('<w:instrText xml:space="preserve">PAGE</w:instrText>');
  });

  it.each([
    ["3-5", 44, 572],
    ["6-8", 40, 500],
    ["9-11", 36, 432],
    ["12-14", 32, 368]
  ] as const)("applies %s poem typography with exact line heights", async (ageBand, poemHalfPoints, lineTwips) => {
    const aged = { ...content, selectedAgeBand: ageBand, effectiveAgeBand: ageBand };
    const result = await documentParts(aged);
    expect(result.document).toContain(`<w:spacing w:after="0" w:line="${lineTwips}" w:lineRule="exact"`);
    expect(result.document).toContain(`<w:sz w:val="${poemHalfPoints}"/>`);
  });

  it("uses exact body line heights so compatible renderers do not reinterpret twips as multiple spacing", async () => {
    const result = await documentParts();
    expect(result.document).toContain('<w:spacing w:after="180" w:line="450" w:lineRule="exact"/>');
  });

  it.each([5, 11, 20])("keeps deterministic page boundaries for %i creatures", async (creatureCount) => {
    const scaled: BookContent = {
      ...content,
      closingNote: undefined,
      creatures: Array.from({ length: creatureCount }, (_, index) => ({
        ...structuredClone(content.creatures[0]!),
        creatureId: `octopus-${index + 1}`,
        displayName: `Octopus ${index + 1}`
      }))
    };
    const result = await documentParts(scaled);
    expect(result.document.match(/<w:pageBreakBefore\/>/g)).toHaveLength(creatureCount * 3);
  }, 15_000);

  it("always includes DOCX when only optional formats are requested", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-formats-"));
    temporaryDirectories.push(directory);
    const { set } = await fixtureIllustrations(directory, ["octopus"]);
    const result = await exportSelectedFormats(content, directory, [], set);
    expect(result.records.map((record) => record.format)).toEqual(["docx"]);
  });

  it("replaces an existing DOCX export without leaving temporary packages", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-reexport-"));
    temporaryDirectories.push(directory);
    const { set } = await fixtureIllustrations(directory, ["octopus"]);
    await exportDocx(content, directory, set);
    const second = await exportDocx({ ...content, closingNote: "A revised closing note." }, directory, set);
    expect(await readdir(directory)).toEqual(expect.arrayContaining([second.relativePath]));
  });

  it.each(["EPERM", "EACCES"])("reports an actionable error and preserves the original DOCX when replacement fails with %s", async (errorCode) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-reexport-locked-"));
    const illustrationDirectory = await mkdtemp(path.join(os.tmpdir(), "bookagent-reexport-locked-art-"));
    temporaryDirectories.push(directory);
    temporaryDirectories.push(illustrationDirectory);
    const { set } = await fixtureIllustrations(illustrationDirectory, ["octopus"]);
    const outputPath = path.join(directory, "ocean-friends.docx");
    const original = Buffer.from("reviewed original DOCX");
    await writeFile(outputPath, original);
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error("DOCX replacement denied"), { code: errorCode }));

    const result = await exportSelectedFormats({ ...content, closingNote: "A revised closing note." }, directory, ["docx"], set);

    expect(result).toEqual({
      records: [],
      failures: [{
        format: "docx",
        code: "docx_output_locked",
        message: "The reviewed DOCX is open or locked. Close it in Microsoft Word or any other application, then retry rework_primary_output."
      }]
    });
    expect(await readFile(outputPath)).toEqual(original);
    expect(await readdir(directory)).toEqual(["ocean-friends.docx"]);
  });
});

describe("PDF exporter", () => {
  it("ignores newline controls during Kannada glyph coverage while rejecting missing printable glyphs", () => {
    const layout = (value: string) => ({ glyphs: [{ id: value.includes("\uE000") ? 0 : 1 }] });
    expect(hasMissingPrintableGlyph(layout, "ಕಾಡಿನ ಹಾದಿಯಲಿ\nಆನೆಯ ಪಯಣ")).toBe(false);
    expect(hasMissingPrintableGlyph(layout, "ಕಾಡಿನ \uE000 ಗೆಳೆಯ")).toBe(true);
  });

  it.skipIf(!process.env.BOOK_AGENT_KANNADA_FONT_PATH)("exports Kannada poem line breaks with an official static font and still rejects an unsupported printable character", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-kannada-pdf-"));
    temporaryDirectories.push(directory);
    const kannada: BookContent = {
      ...content,
      title: "ಕಾಡಿನ ಗೆಳೆಯರು",
      language: "kn",
      creatures: [{
        ...content.creatures[0]!,
        displayName: "ಆನೆ",
        poem: { ...content.creatures[0]!.poem, title: "ಆನೆಯ ಪಯಣ", text: "ಕಾಡಿನ ಹಾದಿಯಲಿ\nಆನೆಯ ಪಯಣ\nಸಂತಸದ ಕ್ಷಣ\n\nಮರದ ನೆರಳಲಿ\nಹಾಯಾದ ನಿದ್ರೆ\nಮುದ್ದಾದ ಗೆಳೆಯ", language: "kn" },
        funFact: { ...content.creatures[0]!.funFact, text: "ಆನೆಗಳು ತಮ್ಮ ಸೊಂಡಿಲನ್ನು ನೀರು ಕುಡಿಯಲು ಬಳಸುತ್ತವೆ.", language: "kn" },
        activity: { ...content.creatures[0]!.activity, text: "ಆನೆಯ ಚಿತ್ರ ಬಿಡಿಸಿ.", language: "kn" }
      }],
      closingNote: "ಪ್ರತಿ ಕಾಡುಜೀವಿಗೂ ತನ್ನದೇ ಪಾತ್ರವಿದೆ."
    };
    const { set } = await fixtureIllustrations(directory, ["octopus"]);
    const record = await exportPdf(kannada, directory, set);
    const document = await getDocument({ data: new Uint8Array(await readFile(path.join(directory, record.relativePath))), useSystemFonts: false }).promise;
    expect(document.numPages).toBe(5);

    await expect(exportPdf({ ...kannada, title: "ಕಾಡಿನ \uE000 ಗೆಳೆಯರು" }, directory, set)).rejects.toMatchObject({ code: "pdf_glyph_missing" });
  });

  it("creates the canonical cover, three section pages, and optional closing page", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-pdf-"));
    temporaryDirectories.push(directory);
    const { set } = await fixtureIllustrations(directory, ["octopus"]);
    const record = await exportPdf(content, directory, set);
    const raw = await readFile(path.join(directory, record.relativePath));
    const document = await getDocument({ data: new Uint8Array(raw), useSystemFonts: false }).promise;
    expect(document.numPages).toBe(5);
    const text: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const pageText = await page.getTextContent();
      text.push(pageText.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    expect(text[0]).toContain("Ocean Friends");
    expect(text[1]).toContain("Waving Arms");
    expect(text[2]).toContain("three hearts");
    expect(text.join(" ")).not.toMatch(/Illustration (?:placeholder|brief|direction|idea)|Accessible description:|Alternative text:/iu);
    expect(text.at(-1)).toContain(content.closingNote);
    expect(raw.toString("latin1")).toMatch(/\/FontFile[23]\b/);
    expect(raw.toString("latin1")).toContain("/StructTreeRoot");
    expect(raw.toString("latin1")).toContain("/Alt");
  });

  it("reports a missing Kannada font without losing mandatory DOCX", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-pdf-"));
    temporaryDirectories.push(directory);
    delete process.env.BOOK_AGENT_KANNADA_FONT_PATH;
    const { set } = await fixtureIllustrations(directory, ["octopus"]);
    const result = await exportSelectedFormats({ ...content, language: "kn" }, directory, ["pdf"], set);
    expect(result.records.map((record) => record.format)).toEqual(["docx"]);
    expect(result.failures).toMatchObject([{ format: "pdf", code: "pdf_font_missing" }]);
  });

  it("fails instead of clipping or adding spill pages", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-pdf-"));
    temporaryDirectories.push(directory);
    const overflowing: BookContent = {
      ...content,
      creatures: [{ ...content.creatures[0]!, funFact: { ...content.creatures[0]!.funFact, text: "A very long fact. ".repeat(800) } }]
    };
    const { set } = await fixtureIllustrations(directory, ["octopus"]);
    await expect(exportPdf(overflowing, directory, set)).rejects.toMatchObject({ code: "pdf_text_overflow" });
    await expect(readFile(path.join(directory, "ocean-friends.pdf"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
