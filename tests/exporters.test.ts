import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { BookContent } from "../src/domain.ts";
import { exportDocx, exportPdf, exportSelectedFormats } from "../src/exporters.ts";

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
  const record = await exportDocx(book, directory);
  const data = await readFile(path.join(directory, record.relativePath));
  const zip = await JSZip.loadAsync(data);
  const part = async (name: string) => zip.file(name)?.async("string") ?? "";
  return { record, data, document: await part("word/document.xml"), styles: await part("word/styles.xml"), core: await part("docProps/core.xml") };
}

describe("DOCX exporter", () => {
  it("emits the approved page model, hierarchy, poem structure, placeholders, and metadata", async () => {
    const result = await documentParts();

    expect(result.record.bytes).toBe(result.data.byteLength);
    expect(result.document.match(/<w:pageBreakBefore\/>/g)).toHaveLength(4);
    expect(result.document).toContain('<w:pgSz w:w="11906" w:h="16838"');
    expect(result.document).toContain('<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"');
    expect(result.document.match(/Illustration placeholder/g)).toHaveLength(3);
    expect(result.document.match(/Accessible description:/g)).toHaveLength(3);
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
  });

  it("declares Kannada language and font without affecting English defaults", async () => {
    const kannada = structuredClone(content);
    kannada.language = "kn";
    kannada.title = "ಸಾಗರ ಸ್ನೇಹಿತರು";
    kannada.creatures[0]!.displayName = "ಆಕ್ಟೋಪಸ್";
    for (const section of [kannada.creatures[0]!.poem, kannada.creatures[0]!.funFact, kannada.creatures[0]!.activity]) section.language = "kn";
    kannada.creatures[0]!.poem.text = "ಅಲೆ ಹಾಡು ಒಂದು\nಅಲೆ ಹಾಡು ಎರಡು\nಅಲೆ ಹಾಡು ಮೂರು\n\nಸಾಗರ ಗೀತೆ ಒಂದು\nಸಾಗರ ಗೀತೆ ಎರಡು\nಸಾಗರ ಗೀತೆ ಮೂರು";
    const result = await documentParts(kannada);

    expect(result.styles).toContain("Noto Sans Kannada");
    expect(result.styles).toContain('<w:lang w:val="kn-IN"/>');
    expect(result.document).toContain("ಸಾಗರ ಸ್ನೇಹಿತರು");
  });

  it.each([
    ["3-5", 44, 572],
    ["6-8", 40, 500],
    ["9-11", 36, 432],
    ["12-14", 32, 368]
  ] as const)("applies %s poem typography", async (ageBand, poemHalfPoints, lineTwips) => {
    const aged = { ...content, selectedAgeBand: ageBand, effectiveAgeBand: ageBand };
    const result = await documentParts(aged);
    expect(result.document).toContain(`<w:spacing w:after="0" w:line="${lineTwips}"`);
    expect(result.document).toContain(`<w:sz w:val="${poemHalfPoints}"/>`);
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
  });

  it("always includes DOCX when only optional formats are requested", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-formats-"));
    temporaryDirectories.push(directory);
    const result = await exportSelectedFormats(content, directory, []);
    expect(result.records.map((record) => record.format)).toEqual(["docx"]);
  });

  it("replaces an existing DOCX export without leaving temporary packages", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-reexport-"));
    temporaryDirectories.push(directory);
    await exportDocx(content, directory);
    const second = await exportDocx({ ...content, closingNote: "A revised closing note." }, directory);
    expect(await readdir(directory)).toEqual([second.relativePath]);
  });

  it("reports an actionable error and preserves the original DOCX when replacement is locked", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-reexport-locked-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "ocean-friends.docx");
    const original = Buffer.from("reviewed original DOCX");
    await writeFile(outputPath, original);
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error("operation not permitted"), { code: "EPERM" }));

    const result = await exportSelectedFormats({ ...content, closingNote: "A revised closing note." }, directory, ["docx"]);

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
  it("creates one cover and three section pages while excluding the optional closing note", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-pdf-"));
    temporaryDirectories.push(directory);
    const record = await exportPdf(content, directory);
    const raw = await readFile(path.join(directory, record.relativePath));
    const document = await getDocument({ data: new Uint8Array(raw), useSystemFonts: false }).promise;
    expect(document.numPages).toBe(4);
    const text: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const pageText = await page.getTextContent();
      text.push(pageText.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    expect(text[0]).toContain("Ocean Friends");
    expect(text[1]).toContain("Waving Arms");
    expect(text[2]).toContain("three hearts");
    expect(text[3]).toContain("Illustration idea");
    expect(text.join(" ")).not.toContain(content.closingNote);
    expect(raw.toString("latin1")).toMatch(/\/FontFile[23]\b/);
  });

  it("reports a missing Kannada font without losing mandatory DOCX", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-pdf-"));
    temporaryDirectories.push(directory);
    delete process.env.BOOK_AGENT_KANNADA_FONT_PATH;
    const result = await exportSelectedFormats({ ...content, language: "kn" }, directory, ["pdf"]);
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
    await expect(exportPdf(overflowing, directory)).rejects.toMatchObject({ code: "pdf_text_overflow" });
    await expect(readFile(path.join(directory, "ocean-friends.pdf"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
