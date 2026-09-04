import { spawnSync } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createQaIllustrations } from "./qa-illustrations.mjs";

const root = process.cwd();
const outputRoot = path.join(root, ".pdf-qa");

function available(command) {
  return spawnSync(command, ["-v"], { encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" }).status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
}

function fixture(count, language = "en") {
  return {
    schemaVersion: "1.1",
    title: language === "kn" ? "ಕಾಡಿನ ಗೆಳೆಯರು" : `Wonderful Creatures — ${count}`,
    language,
    selectedAgeBand: "6-8",
    effectiveAgeBand: "6-8",
    generationAttempt: 0,
    creatures: Array.from({ length: count }, (_, index) => ({
      creatureId: `creature-${index + 1}`,
      displayName: language === "kn" ? `ಕಾಡಿನ ಗೆಳೆಯ ${index + 1}` : `Creature ${index + 1}`,
      poem: { text: language === "kn" ? "ಕಾಡಿನ ಹಾದಿಯಲಿ\nಆನೆಯ ಪಯಣ\nಸಂತಸದ ಕ್ಷಣ\n\nಮರದ ನೆರಳಲಿ\nಹಾಯಾದ ನಿದ್ರೆ\nಮುದ್ದಾದ ಗೆಳೆಯ" : "Dancing softly in the light\nEvery step is small and bright\nResting by a tree\n\nMorning brings a golden glow\nOff into the world we go\nHappy, wild, and free", language, reviewStatus: "human_reviewed", title: language === "kn" ? "ಕಾಡಿನ ಪಯಣ" : `Creature ${index + 1}'s Song`, structureVersion: "1.0", rhymeScheme: "AAB" },
      funFact: { text: language === "kn" ? "ಆನೆಗಳು ತಮ್ಮ ಸೊಂಡಿಲನ್ನು ನೀರು ಕುಡಿಯಲು ಬಳಸುತ್ತವೆ." : `Creature ${index + 1} has a useful fact to discover.`, language, reviewStatus: "source_supported" },
      activity: { text: language === "kn" ? "ಆನೆಯ ಚಿತ್ರ ಬಿಡಿಸಿ." : `Draw creature ${index + 1} safely in its habitat.`, language, reviewStatus: "human_reviewed" },
      illustrationBrief: `A friendly view of creature ${index + 1} in its habitat.`,
      altText: `Creature ${index + 1} shown clearly in its habitat.`
    })),
    closingNote: language === "kn" ? "ಪ್ರತಿ ಕಾಡುಜೀವಿಗೂ ತನ್ನದೇ ಪಾತ್ರವಿದೆ." : "Keep learning about every wonderful creature."
  };
}

const { exportPdf } = await import(pathToFileURL(path.join(root, "dist", "exporters.js")).href);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const canRender = available("pdftoppm");
const manifest = [];
for (const { count, language = "en" } of [
  ...[1, 5, 11, 20].map((count) => ({ count })),
  ...(process.env.BOOK_AGENT_KANNADA_FONT_PATH ? [{ count: 3, language: "kn" }] : [])
]) {
  const directory = path.join(outputRoot, language === "kn" ? "kannada-3-creatures" : `${count}-creatures`);
  await mkdir(directory, { recursive: true });
  const content = fixture(count, language);
  const illustrations = await createQaIllustrations(directory, content.creatures.map((creature) => creature.creatureId));
  const record = await exportPdf(content, directory, illustrations);
  const pdfPath = path.join(directory, record.relativePath);
  const expectedPages = 2 + count * 3;
  if (canRender) {
    run("pdftoppm", ["-png", "-r", "120", pdfPath, path.join(directory, "page")]);
    const renderedPages = (await readdir(directory)).filter((name) => /^page-\d+\.png$/u.test(name)).length;
    if (renderedPages !== expectedPages) throw new Error(`Expected ${expectedPages} rendered pages for ${count} creatures, found ${renderedPages}.`);
  }
  manifest.push({ creatures: count, language, expectedPages, pdf: path.relative(root, pdfPath), rendered: canRender });
}
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(canRender ? `Generated and rendered QA PDFs in ${outputRoot}` : `Generated QA PDFs in ${outputRoot}. Install Poppler to enable PNG rendering.`);
