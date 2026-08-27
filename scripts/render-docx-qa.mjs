import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createQaIllustrations } from "./qa-illustrations.mjs";
import {
  convertOfficeToPdf,
  discoverExecutable,
  rasterizePdf,
  renderTimeoutMs
} from "./render-qa-process.mjs";

const root = process.cwd();
const outputRoot = process.env.AI_BOOKAGENT_DOCX_QA_DIR
  ? path.resolve(process.env.AI_BOOKAGENT_DOCX_QA_DIR)
  : path.join(root, ".docx-qa");
const fixture = (count, language = "en") => ({
  schemaVersion: "1.1", title: language === "kn" ? "ಕಾಡಿನ ಗೆಳೆಯರು" : `Wonderful Creatures - ${count}`, language, selectedAgeBand: "6-8", effectiveAgeBand: "6-8", generationAttempt: 0,
  creatures: Array.from({ length: count }, (_, index) => ({
    creatureId: `creature-${index + 1}`, displayName: language === "kn" ? `ಕಾಡಿನ ಗೆಳೆಯ ${index + 1}` : `Creature ${index + 1}`,
    poem: { text: language === "kn" ? "ಕಾಡಿನ ಹಾದಿಯಲಿ ಆನೆಯ ಪಯಣ\nಕಿವಿಗಳ ಬೀಸಾಟ ಗಾಳಿಯ ಹಾಡು\nಸೊಂಡಿಲ ನೀರಲಿ ತಂಪಾದ ಕ್ಷಣ\n\nಗುಂಪಿನ ಜೊತೆಯಲಿ ಸಂತಸದ ಪಯಣ\nಮರದ ನೆರಳಲಿ ಹಾಯಾದ ನಿದ್ರೆ\nಕಾಡಿನ ಗೆಳೆಯನ ಮುದ್ದಾದ ಕ್ಷಣ" : "Dancing softly in the light\nEvery step is small and bright\nResting by a tree\n\nMorning brings a golden glow\nOff into the world we go\nHappy, wild, and free", language, reviewStatus: "needs_review", title: language === "kn" ? "ಕಾಡಿನ ದೊಡ್ಡ ಗೆಳೆಯ" : `Creature ${index + 1}'s Song`, structureVersion: "1.0", rhymeScheme: "AAB" },
    funFact: { text: language === "kn" ? "ಆನೆಗಳು ತಮ್ಮ ಸೊಂಡಿಲನ್ನು ನೀರು ಕುಡಿಯಲು ಮತ್ತು ವಸ್ತುಗಳನ್ನು ಹಿಡಿಯಲು ಬಳಸುತ್ತವೆ." : `Creature ${index + 1} has a useful fact to discover.`, language, reviewStatus: "source_supported" },
    activity: { text: language === "kn" ? "ಆನೆಯ ಚಿತ್ರವನ್ನು ನೋಡಿ ಅದರ ಕಿವಿ, ಸೊಂಡಿಲು ಮತ್ತು ಕಾಲುಗಳನ್ನು ಗುರುತಿಸಿ ಚಿತ್ರ ಬಿಡಿಸಿ." : `Draw creature ${index + 1} safely in its habitat.`, language, reviewStatus: "human_reviewed" },
    illustrationBrief: `A friendly view of creature ${index + 1} in its habitat.`, altText: `Creature ${index + 1} shown clearly in its habitat.`
  })),
  closingNote: language === "kn"
    ? "ಪ್ರತಿ ಕಾಡುಜೀವಿಗೂ ತನ್ನದೇ ವಾಸಸ್ಥಾನ ಮತ್ತು ಪಾತ್ರವಿದೆ."
    : "Keep wondering about every creature you meet."
});

const { exportDocx } = await import(pathToFileURL(path.join(root, "dist", "exporters.js")).href);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const soffice = discoverExecutable("soffice", "AI_BOOKAGENT_SOFFICE");
const pdftoppm = discoverExecutable("pdftoppm", "AI_BOOKAGENT_PDFTOPPM");
const timeoutMs = renderTimeoutMs();
const canRender = Boolean(soffice && pdftoppm);
const manifest = [];

async function assertRenderedFooters(pdfPath, expectedPages) {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(pdfPath)), useSystemFonts: true }).promise;
  if (pdf.numPages !== expectedPages) {
    throw new Error(`Expected ${expectedPages} rendered DOCX pages, found ${pdf.numPages}.`);
  }
  const footers = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const text = await page.getTextContent();
    const footerText = text.items
      .filter((item) => "str" in item && item.transform[5] < 72)
      .map((item) => item.str)
      .join("")
      .replace(/\s+/gu, " ")
      .trim();
    const expectedFooter = `Page ${pageNumber}`;
    if (footerText !== expectedFooter) {
      throw new Error(`Expected complete footer "${expectedFooter}", found "${footerText}".`);
    }
    footers.push(footerText);
  }
  return footers;
}

for (const { count, language = "en" } of [{ count: 1 }, { count: 5 }, { count: 11 }, { count: 20 }, { count: 3, language: "kn" }]) {
  const directory = path.join(outputRoot, language === "kn" ? "kannada-3-creatures" : `${count}-creatures`);
  await mkdir(directory, { recursive: true });
  const content = fixture(count, language);
  const illustrations = await createQaIllustrations(directory, content.creatures.map((creature) => creature.creatureId));
  const record = await exportDocx(content, directory, illustrations);
  const docxPath = path.join(directory, record.relativePath);
  const expectedLogicalPages = 2 + count * 3;
  let renderedFooters = [];
  if (canRender) {
    const pdfPath = await convertOfficeToPdf(docxPath, directory, soffice, timeoutMs);
    renderedFooters = await assertRenderedFooters(pdfPath, expectedLogicalPages);
    await rasterizePdf(pdfPath, path.join(directory, "page"), pdftoppm, timeoutMs);
  }
  const renderedPages = canRender ? (await readdir(directory)).filter((name) => /^page-\d+\.png$/u.test(name)).length : 0;
  if (canRender && renderedPages !== expectedLogicalPages) {
    throw new Error(`Expected ${expectedLogicalPages} rendered DOCX pages for ${count} creatures, found ${renderedPages}.`);
  }
  manifest.push({ creatures: count, language, expectedLogicalPages, docx: path.relative(root, docxPath), renderedPages, renderedFooters, rendered: canRender });
}
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(canRender
  ? `Generated and rendered QA documents in ${outputRoot}`
  : `Generated QA documents in ${outputRoot}. Install LibreOffice and Poppler, or set AI_BOOKAGENT_SOFFICE and AI_BOOKAGENT_PDFTOPPM, to enable PNG rendering.`);
