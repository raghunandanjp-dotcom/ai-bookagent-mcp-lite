import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestCanvaHandoff } from "../src/canva-adapter.ts";
import { canvaHandoffSchema, prepareCanvaHandoff } from "../src/canva.ts";
import { buildBookDesign } from "../src/design.ts";
import { createProject, loadProject, saveProject } from "../src/project.ts";
import { fixtureIllustrations } from "./fixtures/illustrations.ts";

const request = {
  title: "Ocean Friends",
  theme: "ocean creatures",
  ageBand: "6-8" as const,
  language: "en" as const,
  creatureCount: 1,
  requestedFormats: ["docx" as const]
};

const content = {
  schemaVersion: "1.1" as const,
  title: "Ocean Friends",
  language: "en" as const,
  selectedAgeBand: "6-8" as const,
  effectiveAgeBand: "6-8" as const,
  generationAttempt: 0,
  creatures: [{
    creatureId: "octopus",
    displayName: "Octopus",
    poem: {
      title: "Waving Arms",
      text: "Eight arms wave beneath the sea\nDancing wild and swimming free\nHiding where the corals grow\n\nWaving to the fish below\nGliding through the water blue\nOctopus now waves to you",
      language: "en" as const,
      reviewStatus: "needs_review" as const,
      structureVersion: "1.0" as const,
      rhymeScheme: "AAB" as const
    },
    funFact: { text: "An octopus has three hearts.", language: "en" as const, reviewStatus: "needs_review" as const },
    activity: { text: "Draw and count eight octopus arms.", language: "en" as const, reviewStatus: "needs_review" as const },
    illustrationBrief: "A friendly octopus near coral.",
    altText: "A smiling octopus with eight visible arms."
  }]
};

describe("local Canva handoff ingestion", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), "bookagent-canva-adapter-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  async function seed() {
    const created = createProject(request);
    const { assets } = await fixtureIllustrations(projectDir, ["octopus"]);
    const approvedAt = "2026-08-03T09:58:00.000Z";
    const design = {
      ...buildBookDesign(content, assets, 4, 2, "2026-08-03T09:57:00.000Z"),
      status: "approved" as const,
      approvedAt,
      approvedBy: "Reviewer"
    };
    const project = await saveProject(projectDir, {
      ...created,
      revision: 9,
      sourceRevision: 4,
      stage: "canva_consent_required",
      content,
      illustrations: assets,
      design,
      exports: [{
        format: "docx",
        relativePath: "exports/ocean-friends.docx",
        sha256: "d".repeat(64),
        bytes: 1024,
        createdAt: "2026-08-03T09:58:30.000Z",
        sourceRevision: 4,
        designRevision: 2,
        illustrationSetDigest: design.illustrationSetDigest
      }],
      primaryOutput: {
        status: "accepted",
        sourceRevision: 4,
        designRevision: 2,
        illustrationSetDigest: design.illustrationSetDigest,
        sha256: "d".repeat(64),
        relativePath: "exports/ocean-friends.docx",
        acceptedAt: "2026-08-03T09:58:45.000Z"
      },
      canva: {
        status: "consented",
        readiness: "ready",
        checkedAt: "2026-08-03T09:59:00.000Z",
        consentedAt: "2026-08-03T10:00:00.000Z",
        adapter: { connectorName: "Canva", toolName: "import-design-from-url" },
        sourceRevision: 4,
        designRevision: 2,
        illustrationSetDigest: design.illustrationSetDigest
      }
    });
    const handoff = prepareCanvaHandoff(project.projectId, project.revision, request, content, assets, project.canva, design);
    const loaded = await loadProject(projectDir);
    const reloadedHandoff = prepareCanvaHandoff(loaded.projectId, loaded.revision, loaded.request, loaded.content!, loaded.illustrations, loaded.canva, loaded.design!);
    expect(handoff).toEqual(reloadedHandoff);
    expect(canvaHandoffSchema.parse(handoff)).toEqual(handoff);
    return { project, handoff };
  }

  it("creates a deterministic private file-import artifact from exact approved bytes", async () => {
    const { handoff } = await seed();
    const first = await ingestCanvaHandoff(projectDir, handoff);
    if (first.outcome !== "ready") throw new Error(JSON.stringify(first));
    expect(first).toMatchObject({
      outcome: "ready",
      connectorOperation: "import_design_from_file",
      ingestionMode: "local_file_artifact",
      sourceRevision: 4,
      designRevision: 2,
      illustrationSetDigest: handoff.illustrationSetDigest,
      pageCount: handoff.pages.length
    });
    expect(first.connectorRequest).toMatchObject({
      capability: "import_design_from_url",
      arguments: {
        design_file: first.designFile,
        intended_design_type: "presentation",
        name: handoff.title
      }
    });
    expect(first.designFile.startsWith(projectDir)).toBe(true);
    const firstBytes = await readFile(first.designFile);
    const html = firstBytes.toString("utf8");
    expect(html.match(/data-document-role="page"/gu)).toHaveLength(handoff.pages.length);
    expect(html).toContain(`data-illustration-set-digest="${handoff.illustrationSetDigest}"`);
    expect(html).toContain(`"consentedAt":"${handoff.authorization.consentedAt}"`);
    expect(html).toContain(`"sha256":"${handoff.illustrations[0]!.sha256}"`);
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toMatch(/https?:\/\//u);

    const second = await ingestCanvaHandoff(projectDir, handoff);
    expect(second).toMatchObject({ outcome: "ready", artifactSha256: first.artifactSha256, artifactBytes: first.artifactBytes });
    if (second.outcome !== "ready") throw new Error(second.message);
    expect(await readFile(second.designFile)).toEqual(firstBytes);
  }, 20_000);

  it("rejects redesign, substitution, and stale neutral payloads without writing an artifact", async () => {
    const { handoff } = await seed();
    const redesign = structuredClone(handoff) as typeof handoff;
    redesign.mode = "explicit_redesign_requested";
    expect(await ingestCanvaHandoff(projectDir, redesign)).toEqual({
      outcome: "failed",
      code: "redesign_rejected",
      message: expect.stringMatching(/faithful_canonical_reproduction/u),
      retryable: false
    });

    const substituted = structuredClone(handoff);
    substituted.illustrations[0]!.provenance.createdBy = "Replacement generator";
    expect(await ingestCanvaHandoff(projectDir, substituted)).toMatchObject({ outcome: "failed", code: "canonical_handoff_mismatch", retryable: false });
    await expect(readFile(path.join(projectDir, "canva", "ocean-friends-canva-import.html"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns a structured non-retryable failure when approved local bytes change", async () => {
    const { handoff } = await seed();
    await writeFile(path.join(projectDir, handoff.illustrations[0]!.relativePath), "tampered");
    expect(await ingestCanvaHandoff(projectDir, handoff)).toMatchObject({
      outcome: "failed",
      code: "asset_integrity_mismatch",
      retryable: false
    });
  });
});
