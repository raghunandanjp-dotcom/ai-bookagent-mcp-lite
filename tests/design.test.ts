import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBookDesign, renderBookDesignHtml } from "../src/design.ts";
import { importCodeNativeIllustrationSet, sanitizeCodeNativeSvg } from "../src/svg-illustrations.ts";
import { pptxFixture } from "./fixtures/pptx-content.ts";
import {
  acceptBookContent,
  approveBookDesign,
  approveCreatureSelection,
  createBookDesignPreview,
  generateDocuments,
  importProjectCodeNativeIllustrationSet,
  initializeProject,
  updateCreatureSelection
} from "../src/workflow.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

const safeSvg = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect x="0" y="0" width="800" height="500" fill="${fill}"/><circle cx="400" cy="250" r="120" fill="#FFFFFF" stroke="#17324D" stroke-width="12"/></svg>`;

describe("canonical BookDesign and code-native illustrations", () => {
  it("accepts only the constrained, dependency-free SVG subset", () => {
    expect(sanitizeCodeNativeSvg(safeSvg("#2A9D8F"))).toContain("<circle");
    for (const unsafe of [
      `<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>`,
      `<svg viewBox="0 0 10 10"><image href="https://example.com/a.png"/></svg>`,
      `<svg viewBox="0 0 10 10"><rect width="10" height="10" onclick="alert(1)"/></svg>`,
      `<svg viewBox="0 0 10 10"><text x="1" y="2">title</text></svg>`
    ]) expect(() => sanitizeCodeNativeSvg(unsafe)).toThrow(/SVG/i);
  }, 15_000);

  it("requires one exact batch and rasterizes every SVG locally to checksum-bound PNG", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "bookagent-design-"));
    temporaryDirectories.push(projectDir);
    const { content } = pptxFixture(1);
    const input = [
      { role: "cover" as const, svg: safeSvg("#145A6A"), altText: "A friendly creature-book cover." },
      { role: "creature" as const, creatureId: "creature-1", svg: safeSvg("#F4A261"), altText: "Creature 1 in a colorful habitat." }
    ];
    const assets = await importCodeNativeIllustrationSet(projectDir, content, input);
    expect(assets.map((asset) => asset.assetId)).toEqual(["cover", "creature-creature-1"]);
    expect(assets.every((asset) => asset.source === "code_native" && asset.mimeType === "image/png" && asset.width === 1600)).toBe(true);
    expect(await readFile(path.join(projectDir, assets[0]!.relativePath))).toEqual(expect.objectContaining({ length: assets[0]!.bytes }));
    await expect(importCodeNativeIllustrationSet(projectDir, content, input.slice(0, 1))).rejects.toThrow(/exactly match the required slots/i);
  }, 15_000);

  it("uses one canonical page plan and accessible asset references in HTML", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "bookagent-design-"));
    temporaryDirectories.push(projectDir);
    const { content } = pptxFixture(1);
    const assets = await importCodeNativeIllustrationSet(projectDir, content, [
      { role: "cover", svg: safeSvg("#145A6A"), altText: "Accessible cover." },
      { role: "creature", creatureId: "creature-1", svg: safeSvg("#F4A261"), altText: "Accessible creature." }
    ]);
    const design = buildBookDesign(content, assets, 5, 1, "2026-08-04T10:00:00.000Z");
    expect(design.pages.map((page) => page.type)).toEqual(["cover", "poem", "funFact", "activity", "closing"]);
    const html = renderBookDesignHtml(design, {
      cover: { href: "../assets/cover.png", altText: "Accessible cover." },
      "creature-creature-1": { href: "../assets/creature.png", altText: "Accessible creature." }
    });
    expect(html).toContain('data-design-revision="1"');
    expect(html).toContain('alt="Accessible creature."');
    expect(html).toContain("Keep Exploring");
    expect(html).not.toMatch(/https?:\/\//u);
  }, 15_000);

  it("completes the public SVG-to-HTML-approval-to-DOCX workflow without external image paths", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "bookagent-design-flow-"));
    temporaryDirectories.push(projectDir);
    const { content, approved } = pptxFixture(1);
    await initializeProject(projectDir, { title: content.title, theme: "wonderful creatures", creatureCount: 1, ageBand: "6-8", language: "en" });
    await updateCreatureSelection(projectDir, approved);
    await approveCreatureSelection(projectDir);
    await acceptBookContent(projectDir, content);
    const imported = await importProjectCodeNativeIllustrationSet(projectDir, [
      { role: "cover", svg: safeSvg("#17324D"), altText: "Accessible cover." },
      { role: "creature", creatureId: "creature-1", svg: safeSvg("#E76F51"), altText: "Accessible creature." }
    ]);
    expect(imported.illustrations.every((asset) => asset.source === "code_native" && asset.approvalStatus === "pending_review")).toBe(true);
    const previewed = await createBookDesignPreview(projectDir);
    expect(await readFile(path.join(projectDir, previewed.designPreview!.relativePath), "utf8")).toContain("Wonderful Creatures");
    const approvedDesign = await approveBookDesign(projectDir, "Release reviewer");
    expect(approvedDesign.illustrations.every((asset) => asset.approvalStatus === "approved")).toBe(true);
    const exported = await generateDocuments(projectDir, ["docx"]);
    expect(exported.primaryOutput).toMatchObject({
      status: "ready_for_review",
      sourceRevision: exported.sourceRevision,
      designRevision: approvedDesign.design!.designRevision,
      illustrationSetDigest: approvedDesign.design!.illustrationSetDigest
    });
  }, 15_000);
});
