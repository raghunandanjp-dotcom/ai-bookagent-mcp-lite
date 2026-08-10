import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createQaIllustrations } from "./qa-illustrations.mjs";

const root = process.cwd();
const outputRoot = path.join(root, ".pptx-qa");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function available(command) {
  const probe = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], { encoding: "utf8" });
  return probe.status === 0;
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
      poem: { text: `Creature ${index + 1} dances softly tonight\nUnder stars it feels just right\nThen it rests beside a tree\n\nMorning brings a golden glow\nOff into the world we go\nHappy, curious, wild and free`, language: "en", reviewStatus: "human_reviewed", title: `Creature ${index + 1}'s Song`, structureVersion: "1.0", rhymeScheme: "AAB" },
      funFact: { text: `Creature ${index + 1} has a useful fact to discover.`, language: "en", reviewStatus: "source_supported" },
      activity: { text: `Draw creature ${index + 1} safely in its habitat.`, language: "en", reviewStatus: "human_reviewed" },
      illustrationBrief: `A friendly view of creature ${index + 1} in its habitat.`,
      altText: `Creature ${index + 1} shown clearly in its habitat.`
    })),
    closingNote: "Keep learning about every wonderful creature."
  };
}

const { exportPptx } = await import(pathToFileURL(path.join(root, "dist", "exporters.js")).href);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const canRender = available("soffice") && available("pdftoppm");
const manifest = [];
for (const count of [1, 5, 11, 20]) {
  const directory = path.join(outputRoot, `${count}-creatures`);
  await mkdir(directory, { recursive: true });
  const content = fixture(count);
  const illustrations = await createQaIllustrations(directory, content.creatures.map((creature) => creature.creatureId));
  const record = await exportPptx(content, directory, illustrations, { ageBand: "6-8", language: "en" });
  const pptxPath = path.join(directory, record.relativePath);
  const expectedSlides = 2 + count * 3;
  if (canRender) {
    run("soffice", ["--headless", "--convert-to", "pdf", "--outdir", directory, pptxPath]);
    const pdfPath = path.join(directory, `${path.parse(record.relativePath).name}.pdf`);
    run("pdftoppm", ["-png", "-r", "120", pdfPath, path.join(directory, "slide")]);
    const renderedSlides = (await readdir(directory)).filter((name) => /^slide-\d+\.png$/u.test(name)).length;
    if (renderedSlides !== expectedSlides) throw new Error(`Expected ${expectedSlides} rendered slides for ${count} creatures, found ${renderedSlides}.`);
  }
  manifest.push({ creatures: count, expectedSlides, pptx: path.relative(root, pptxPath), rendered: canRender });
}

await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(canRender
  ? `Generated and rendered QA decks in ${outputRoot}`
  : `Generated QA decks in ${outputRoot}. Install LibreOffice and Poppler to enable PNG rendering.`);
