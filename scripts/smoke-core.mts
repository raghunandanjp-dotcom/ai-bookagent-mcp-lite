import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createProject } from "../src/project.ts";
import { approveSelection, beginSelection, batchCreatures } from "../src/selection.ts";
import { prepareAuthoringPrompts } from "../src/prompts.ts";
import { validateBookContent } from "../src/validation.ts";
import { prepareIllustrationPrompts } from "../src/illustrations.ts";

const request = JSON.parse(await readFile("examples/ocean-friends/request.json", "utf8"));
const creatures = JSON.parse(await readFile("examples/ocean-friends/creatures.json", "utf8"));
const content = JSON.parse(await readFile("examples/ocean-friends/content.json", "utf8"));
const project = createProject(request);
const selection = approveSelection(beginSelection(creatures));
const prompts = prepareAuthoringPrompts(project.request, selection.current);
const validation = validateBookContent(content, selection.current);
const illustrationPrompts = prepareIllustrationPrompts(project.request, validation.content!);

assert.deepEqual(project.request.outputFormats, ["docx", "pptx", "pdf"]);
assert.equal(batchCreatures(selection.current).length, 1);
assert.equal(prompts.provider, "host-assisted");
assert.equal(prompts.batches.length, 1);
assert.match(prompts.batches[0].prompt, /data-only/);
assert.equal(validation.report.valid, true);
assert.equal(validation.report.creaturesCovered.length, 5);
assert.equal(validation.report.pageCount, 17);
assert.equal(illustrationPrompts.assetCount, 6);
assert.deepEqual(illustrationPrompts.assets.map((asset) => asset.assetId), ["cover", ...creatures.map((creature: { id: string }) => `creature-${creature.id}`)]);

const second = beginSelection([{ ...creatures[0], id: "seal", name: "Seal", aliases: [] }], selection);
const third = beginSelection([{ ...creatures[0], id: "walrus", name: "Walrus", aliases: [] }], second);
assert.throws(
  () => beginSelection([{ ...creatures[0], id: "orca", name: "Orca", aliases: [] }], third),
  /two creature-list regenerations/
);

console.log("Core smoke checks passed.");
