import { spawnSync } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outputRoot = path.join(root, ".pdf-qa");

function available(command) {
  return spawnSync(command, ["-v"], { encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" }).status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
}

function fixture(count) {
  return {
    schemaVersion: "1.1",
    title: `Wonderful Creatures — ${count}`,
    language: "en",
    selectedAgeBand: "6-8",
    effectiveAgeBand: "6-8",
    generationAttempt: 0,
    creatures: Array.from({ length: count }, (_, index) => ({
      creatureId: `creature-${index + 1}`,
      displayName: `Creature ${index + 1}`,
      poem: { text: "Dancing softly in the light\nEvery step is small and bright\nResting by a tree\n\nMorning brings a golden glow\nOff into the world we go\nHappy, wild, and free", language: "en", reviewStatus: "human_reviewed", title: `Creature ${index + 1}'s Song`, structureVersion: "1.0", rhymeScheme: "AAB" },
      funFact: { text: `Creature ${index + 1} has a useful fact to discover.`, language: "en", reviewStatus: "source_supported" },
      activity: { text: `Draw creature ${index + 1} safely in its habitat.`, language: "en", reviewStatus: "human_reviewed" },
      illustrationBrief: `A friendly view of creature ${index + 1} in its habitat.`,
      altText: `Creature ${index + 1} shown clearly in its habitat.`
    })),
    closingNote: "Excluded from the MVP PDF."
  };
}

const { exportPdf } = await import(pathToFileURL(path.join(root, "dist", "exporters.js")).href);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const canRender = available("pdftoppm");
const manifest = [];
for (const count of [1, 5, 11, 20]) {
  const directory = path.join(outputRoot, `${count}-creatures`);
  await mkdir(directory, { recursive: true });
  const record = await exportPdf(fixture(count), directory);
  const pdfPath = path.join(directory, record.relativePath);
  const expectedPages = 1 + count * 3;
  if (canRender) {
    run("pdftoppm", ["-png", "-r", "120", pdfPath, path.join(directory, "page")]);
    const renderedPages = (await readdir(directory)).filter((name) => /^page-\d+\.png$/u.test(name)).length;
    if (renderedPages !== expectedPages) throw new Error(`Expected ${expectedPages} rendered pages for ${count} creatures, found ${renderedPages}.`);
  }
  manifest.push({ creatures: count, expectedPages, pdf: path.relative(root, pdfPath), rendered: canRender });
}
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(canRender ? `Generated and rendered QA PDFs in ${outputRoot}` : `Generated QA PDFs in ${outputRoot}. Install Poppler to enable PNG rendering.`);
