import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { exportPptx } from "../src/exporters.ts";
import { pptxFixture } from "./fixtures/pptx-content.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function generate(count: number, language: "en" | "kn" = "en") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bookagent-pptx-"));
  temporaryDirectories.push(directory);
  const { content } = pptxFixture(count, language);
  const record = await exportPptx(content, directory, { ageBand: "6-8", language });
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
    });
  }

  it("keeps content editable and includes metadata and accessible placeholder copy", async () => {
    const { zip, slides } = await generate(1);
    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).toContain("Wonderful Creatures");
    expect(core).toContain("AI Book Agent MCP Lite");
    expect(slides[1]).toContain("Illustration brief:");
    expect(slides[1]).toContain("Alternative text:");
    expect(slides[1]).toContain("<a:t>");
    expect(slides[1]).not.toContain("normAutofit");
    expect(Object.entries(zip.files).some(([name, entry]) => name.startsWith("ppt/media/") && !entry.dir)).toBe(false);
  });

  it("uses and reports the non-embedded experimental Kannada font", async () => {
    const { record, slides, zip } = await generate(1, "kn");
    expect(record.warnings?.[0]).toMatch(/Noto Sans Kannada/u);
    expect(slides.join("\n")).toContain("Noto Sans Kannada");
    expect(slides.join("\n")).toContain('lang="kn-IN"');
  });
});
