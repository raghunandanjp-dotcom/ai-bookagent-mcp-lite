import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createQaIllustrations } from "./qa-illustrations.mjs";

const root = process.cwd();
const outputRoot = path.join(root, ".docx-qa");
const available = (command) => spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], { encoding: "utf8" }).status === 0;
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
};
const fixture = (count) => ({
  schemaVersion: "1.1", title: `Wonderful Creatures - ${count}`, language: "en", selectedAgeBand: "6-8", effectiveAgeBand: "6-8", generationAttempt: 0,
  creatures: Array.from({ length: count }, (_, index) => ({
    creatureId: `creature-${index + 1}`, displayName: `Creature ${index + 1}`,
    poem: { text: "Dancing softly in the light\nEvery step is small and bright\nResting by a tree\n\nMorning brings a golden glow\nOff into the world we go\nHappy, wild, and free", language: "en", reviewStatus: "human_reviewed", title: `Creature ${index + 1}'s Song`, structureVersion: "1.0", rhymeScheme: "AAB" },
    funFact: { text: `Creature ${index + 1} has a useful fact to discover.`, language: "en", reviewStatus: "source_supported" },
    activity: { text: `Draw creature ${index + 1} safely in its habitat.`, language: "en", reviewStatus: "human_reviewed" },
    illustrationBrief: `A friendly view of creature ${index + 1} in its habitat.`, altText: `Creature ${index + 1} shown clearly in its habitat.`
  }))
});

const { exportDocx } = await import(pathToFileURL(path.join(root, "dist", "exporters.js")).href);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const canRender = available("soffice") && available("pdftoppm");
const manifest = [];
for (const count of [1, 5, 11, 20]) {
  const directory = path.join(outputRoot, `${count}-creatures`);
  await mkdir(directory, { recursive: true });
  const content = fixture(count);
  const illustrations = await createQaIllustrations(directory, content.creatures.map((creature) => creature.creatureId));
  const record = await exportDocx(content, directory, illustrations);
  const docxPath = path.join(directory, record.relativePath);
  if (canRender) {
    run("soffice", ["--headless", "--convert-to", "pdf", "--outdir", directory, docxPath]);
    run("pdftoppm", ["-png", "-r", "120", path.join(directory, `${path.parse(record.relativePath).name}.pdf`), path.join(directory, "page")]);
  }
  manifest.push({ creatures: count, expectedLogicalPages: 1 + count * 3, docx: path.relative(root, docxPath), renderedPages: canRender ? (await readdir(directory)).filter((name) => /^page-\d+\.png$/u.test(name)).length : 0, rendered: canRender });
}
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(canRender ? `Generated and rendered QA documents in ${outputRoot}` : `Generated QA documents in ${outputRoot}. Install LibreOffice and Poppler to enable PNG rendering.`);
