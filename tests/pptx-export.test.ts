import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { exportPptx } from "../src/exporters.ts";
import { pptxFixture } from "./fixtures/pptx-content.ts";
import { fixtureIllustrations } from "./fixtures/illustrations.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function generate(count: number, language: "en" | "kn" = "en") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-pptx-"));
  temporaryDirectories.push(directory);
  const { content } = pptxFixture(count, language);
  const { set } = await fixtureIllustrations(directory, content.creatures.map((creature) => creature.creatureId));
  const record = await exportPptx(content, directory, set, { ageBand: "6-8", language });
  const zip = await JSZip.loadAsync(await readFile(path.join(directory, record.relativePath)));
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort((a, b) => Number(a.match(/\d+/u)![0]) - Number(b.match(/\d+/u)![0]));
  const slides = await Promise.all(slideNames.map((name) => zip.file(name)!.async("string")));
  return { record, zip, slides };
}

describe("editable PPTX export", () => {
  for (const count of [1, 5, 11, 20]) {
    it(`creates exactly ${1 + count * 3} ordered slides for ${count} creatures`, async () => {
      const { slides } = await generate(count);
      expect(slides).toHaveLength(1 + count * 3);
      for (let index = 0; index < count; index += 1) {
        const offset = 1 + index * 3;
        expect(slides[offset]).toContain(`Creature ${index + 1}`);
        expect(slides[offset]).toContain("Poem");
        expect(slides[offset + 1]).toContain("Fun Fact");
        expect(slides[offset + 2]).toContain("Activity");
      }
    }, 15_000);
  }

  it("keeps text editable and embeds accessible approved artwork without production copy", async () => {
    const { zip, slides } = await generate(1);
    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).toContain("Wonderful Creatures");
    expect(core).toContain("AI Book Agent MCP Lite");
    expect(slides.join("\n")).not.toMatch(/Illustration (?:placeholder|brief|direction|idea)|Accessible description:|Alternative text:/iu);
    expect(slides[0]).toContain('descr="A colorful scene introducing the creatures."');
    expect(slides[1]).toContain('descr="creature-1 in a colorful habitat."');
    expect(slides[1]).toContain("<a:t>");
    expect(slides[1]).not.toContain("normAutofit");
    expect(Object.entries(zip.files).filter(([name, entry]) => name.startsWith("ppt/media/") && !entry.dir)).toHaveLength(4);
    const media = Object.entries(zip.files).filter(([name, entry]) => name.startsWith("ppt/media/") && !entry.dir);
    const digests = await Promise.all(media.map(async ([, entry]) => createHash("sha256").update(await entry.async("nodebuffer")).digest("hex")));
    expect(new Set(digests).size).toBe(2);
    expect([...new Set(digests)].map((digest) => digests.filter((candidate) => candidate === digest).length).sort()).toEqual([1, 3]);
  });

  it("uses and reports the non-embedded experimental Kannada font", async () => {
    const { record, slides, zip } = await generate(1, "kn");
    expect(record.warnings?.[0]).toMatch(/Noto Sans Kannada/u);
    expect(slides.join("\n")).toContain("Noto Sans Kannada");
    expect(slides.join("\n")).toContain('lang="kn-IN"');
  });
});
