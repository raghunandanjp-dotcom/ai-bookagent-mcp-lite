import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptBookContent,
  approveCreatureSelection,
  approveBookDesign,
  createBookDesignPreview,
  createIllustrationPromptPackage,
  generateDocuments,
  importProjectIllustration,
  initializeProject,
  reviewProjectIllustration,
  updateCreatureSelection
} from "../src/workflow.ts";
import { loadProject, resolveInside, saveProject } from "../src/project.ts";
import { fixtureIllustrations } from "./fixtures/illustrations.ts";
import { pptxFixture } from "./fixtures/pptx-content.ts";
import { inspectIllustration } from "../src/illustrations.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function preparedProject() {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "bookagent-project-"));
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), "bookagent-source-"));
  temporaryDirectories.push(projectDir, sourceDir);
  const { content, approved } = pptxFixture(1);
  await initializeProject(projectDir, { title: content.title, theme: "wonderful creatures", creatureCount: 1, ageBand: "6-8", language: "en" });
  await updateCreatureSelection(projectDir, approved);
  await approveCreatureSelection(projectDir);
  await acceptBookContent(projectDir, content);
  const source = await fixtureIllustrations(sourceDir, [approved[0]!.id]);
  return { projectDir, content, source };
}

async function importAndApproveIllustrations(projectDir: string, source: Awaited<ReturnType<typeof fixtureIllustrations>>) {
  for (const asset of [source.set.cover, ...source.set.creatures.values()]) {
    await importProjectIllustration(projectDir, {
      ...metadata,
      role: asset.role,
      creatureId: asset.creatureId,
      sourcePath: asset.absolutePath,
      altText: asset.altText
    });
    await reviewProjectIllustration(projectDir, asset.assetId, true, "Art reviewer");
  }
}

const metadata = {
  source: "host_generated" as const,
  provenance: { generator: "Host image tool", model: "Illustration model" },
  license: { name: "Project publication license", attribution: "Created for this book" }
};

const unsupportedParserInputs = {
  icns: Buffer.concat([Buffer.from("icns", "ascii"), Buffer.alloc(64, 0xff)]),
  jxl: Buffer.concat([Buffer.from([0xff, 0x0a]), Buffer.alloc(66, 0xff)]),
  heif: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic", "ascii"), Buffer.alloc(60, 0xff)])
} as const;

describe("approved illustration workflow", () => {
  it("prepares one cover plus one creature prompt and blocks export until both imported assets are approved", async () => {
    const { projectDir, content, source } = await preparedProject();
    const prompts = await createIllustrationPromptPackage(projectDir);
    expect(prompts.assetCount).toBe(2);
    expect(prompts.assets.map((asset) => asset.assetId)).toEqual(["cover", "creature-creature-1"]);

    await importProjectIllustration(projectDir, {
      ...metadata,
      role: "cover",
      sourcePath: source.set.cover.absolutePath,
      altText: "All creatures gather in a bright landscape."
    });
    await importProjectIllustration(projectDir, {
      ...metadata,
      role: "creature",
      creatureId: "creature-1",
      sourcePath: source.set.creatures.get("creature-1")!.absolutePath,
      altText: "Creature 1 explores its colorful habitat."
    });

    await expect(generateDocuments(projectDir, ["docx"])).rejects.toThrow(/HTML book design/i);
    await reviewProjectIllustration(projectDir, "cover", true, "Art reviewer", "Composition approved.");
    await reviewProjectIllustration(projectDir, "creature-creature-1", true, "Art reviewer");
    const approved = await loadProject(projectDir);
    expect(approved.stage).toBe("illustrations_ready");
    expect(approved.illustrations).toHaveLength(2);
    expect(approved.illustrations[0]).toMatchObject({ mimeType: "image/png", width: 640, height: 360, source: "host_generated", approvalStatus: "approved", approvedBy: "Art reviewer" });
    expect(approved.illustrations.every((asset) => /^[a-f0-9]{64}$/u.test(asset.sha256))).toBe(true);

    await createBookDesignPreview(projectDir);
    await approveBookDesign(projectDir, "Book reviewer");
    const exported = await generateDocuments(projectDir, ["docx"]);
    expect(exported.exports.find((record) => record.format === "docx")).toBeDefined();
    expect(content.creatures).toHaveLength(1);
  });

  it("rejects unsupported imports and detects an approved asset changed on disk", async () => {
    const { projectDir, source } = await preparedProject();
    const invalidPath = path.join(projectDir, "not-an-image.txt");
    await writeFile(invalidPath, "not an image");
    await expect(importProjectIllustration(projectDir, {
      ...metadata,
      role: "cover",
      sourcePath: invalidPath,
      altText: "Invalid asset"
    })).rejects.toThrow(/valid PNG or JPEG/i);

    for (const asset of [source.set.cover, source.set.creatures.get("creature-1")!]) {
      await importProjectIllustration(projectDir, {
        ...metadata,
        role: asset.role,
        creatureId: asset.creatureId,
        sourcePath: asset.absolutePath,
        altText: asset.altText
      });
      await reviewProjectIllustration(projectDir, asset.assetId, true, "Art reviewer");
    }
    await createBookDesignPreview(projectDir);
    await approveBookDesign(projectDir, "Book reviewer");
    const project = await loadProject(projectDir);
    const creatureAsset = project.illustrations.find((asset) => asset.role === "creature")!;
    await writeFile(resolveInside(projectDir, creatureAsset.relativePath), "corrupt image bytes");
    await expect(generateDocuments(projectDir, ["docx"])).rejects.toThrow(/missing, unreadable, or corrupt/i);
  });

  it("rejects crafted ICNS, JXL, and HEIF before persistence or document-export parsing", async () => {
    const { projectDir, source } = await preparedProject();
    const beforeProject = await readFile(path.join(projectDir, "book-project.json"));
    for (const [format, data] of Object.entries(unsupportedParserInputs)) {
      expect(() => inspectIllustration(data)).toThrow(/valid PNG or JPEG/i);
      const sourcePath = path.join(source.set.cover.absolutePath, "..", `${format}.bin`);
      await writeFile(sourcePath, data);
      await expect(importProjectIllustration(projectDir, {
        ...metadata,
        role: "cover",
        sourcePath,
        altText: `Crafted ${format} asset`
      })).rejects.toThrow(/valid PNG or JPEG/i);
      expect(await readFile(path.join(projectDir, "book-project.json"))).toEqual(beforeProject);
    }
    expect((await loadProject(projectDir)).illustrations).toEqual([]);
  }, 2_000);

  it("reports missing, unexpected, and digest-mismatched approved illustration sets", async () => {
    const { projectDir, source } = await preparedProject();

    await expect(createBookDesignPreview(projectDir))
      .rejects.toThrow(/cover: expected exactly one illustration asset/i);

    await importAndApproveIllustrations(projectDir, source);
    const approved = await loadProject(projectDir);
    await saveProject(projectDir, {
      ...approved,
      illustrations: [
        ...approved.illustrations,
        {
          ...approved.illustrations[0]!,
          assetId: "creature-unexpected",
          role: "creature",
          creatureId: "unexpected",
          altText: "Unexpected creature illustration."
        }
      ]
    });
    await expect(createBookDesignPreview(projectDir))
      .rejects.toThrow(/unexpected illustration slots: creature-unexpected/i);

    const withUnexpected = await loadProject(projectDir);
    const expectedAssets = withUnexpected.illustrations.filter((asset) => asset.assetId !== "creature-unexpected");
    expectedAssets[0] = { ...expectedAssets[0]!, sha256: "0".repeat(64) };
    await saveProject(projectDir, { ...approved, illustrations: expectedAssets });
    await expect(createBookDesignPreview(projectDir))
      .rejects.toThrow(/stored illustration digest does not match the approved asset/i);
  });

  it("rejects approval when the rendered HTML preview changed after creation", async () => {
    const { projectDir, source } = await preparedProject();
    await importAndApproveIllustrations(projectDir, source);
    const previewed = await createBookDesignPreview(projectDir);
    await writeFile(resolveInside(projectDir, previewed.designPreview!.relativePath), "tampered preview");
    await expect(approveBookDesign(projectDir, "Book reviewer")).rejects.toThrow(/preview changed/i);
    expect((await loadProject(projectDir)).design?.status).toBe("ready_for_review");
  });
});
