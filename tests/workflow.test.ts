import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptBookContent,
  acceptCanvaResult,
  acceptPrimaryOutput,
  approveCreatureSelection,
  consentToCanva,
  createPromptPackage,
  generateDocuments,
  getCanvaHandoff,
  initializeProject,
  reworkPrimaryOutput,
  selectCanvaDesign,
  reiterateAuthoringPrompt,
  setCanvaCapability,
  updateCreatureSelection
} from "../src/workflow.ts";
import { loadProject, saveProject } from "../src/project.ts";
import { exportSelectedFormats } from "../src/exporters.ts";
import { fixtureIllustrations } from "./fixtures/illustrations.ts";

vi.mock("../src/exporters.ts", () => ({
  exportSelectedFormats: vi.fn(async (_content, _dir, formats: Array<"docx" | "pptx" | "pdf">, _illustrations, context?: { ensureDocx?: boolean }) => ({
    records: Array.from(new Set(context?.ensureDocx === false ? formats : ["docx" as const, ...formats])).map((format) => ({
      format,
      relativePath: `ocean-friends.${format}`,
      sha256: format[0].repeat(64),
      bytes: 1024,
      createdAt: new Date().toISOString()
    })),
    failures: []
  }))
}));

const creature = {
  id: "octopus",
  name: "Octopus",
  aliases: [],
  status: "living" as const,
  groups: ["mollusc"],
  habitats: ["ocean"],
  pinned: false
};

const section = (text: string) => ({
  text,
  language: "en" as const,
  reviewStatus: "needs_review" as const
});

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
    poem: { ...section("Eight arms wave beneath the sea\nDancing wild and swimming free\nHiding where the corals grow\n\nWaving to the fish below\nGliding through the water blue\nOctopus now waves to you"), title: "Waving Arms", structureVersion: "1.0" as const, rhymeScheme: "AAB" as const },
    funFact: section("An octopus has three hearts."),
    activity: section("Draw and count eight octopus arms."),
    illustrationBrief: "A friendly octopus near coral.",
    altText: "A smiling octopus with eight visible arms."
  }]
};

async function seedIllustrations(projectDir: string) {
  const project = await loadProject(projectDir);
  const { assets } = await fixtureIllustrations(projectDir, content.creatures.map((item) => item.creatureId));
  await saveProject(projectDir, { ...project, illustrations: assets });
}

describe("persisted workflow bookkeeping", () => {
  let projectDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T10:00:00.000Z"));
    projectDir = await mkdtemp(path.join(os.tmpdir(), "bookagent-workflow-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("increments and returns the persisted revision for approval and exports", async () => {
    const created = await initializeProject(projectDir, {
      title: "Ocean Friends",
      theme: "ocean creatures",
      creatureCount: 1
    });
    expect(created.revision).toBe(1);

    vi.setSystemTime(new Date("2026-07-31T10:00:01.000Z"));
    const selected = await updateCreatureSelection(projectDir, [creature]);
    expect(selected.revision).toBe(2);

    vi.setSystemTime(new Date("2026-07-31T10:00:02.000Z"));
    const approved = await approveCreatureSelection(projectDir);
    const reloadedApproval = await loadProject(projectDir);
    expect(approved).toMatchObject({
      revision: 3,
      updatedAt: "2026-07-31T10:00:02.000Z",
      stage: "selection_approved",
      selection: { approved: true }
    });
    expect(reloadedApproval.revision).toBe(approved.revision);
    expect(reloadedApproval.updatedAt).toBe(approved.updatedAt);

    const beforePromptRevision = approved.revision;
    await createPromptPackage(projectDir);
    expect((await loadProject(projectDir)).revision).toBe(beforePromptRevision);

    vi.setSystemTime(new Date("2026-07-31T10:00:03.000Z"));
    const accepted = await acceptBookContent(projectDir, content);
    expect(accepted.project.revision).toBe(4);
    await seedIllustrations(projectDir);

    vi.setSystemTime(new Date("2026-07-31T10:00:04.000Z"));
    const exported = await generateDocuments(projectDir, ["docx"]);
    expect(vi.mocked(exportSelectedFormats)).toHaveBeenLastCalledWith(
      content,
      expect.stringMatching(/[\\/]exports$/u),
      ["docx"],
      expect.anything(),
      expect.objectContaining({ ageBand: "6-8", language: "en" })
    );
    const reloadedExport = await loadProject(projectDir);
    expect(exported).toMatchObject({
      revision: 5,
      updatedAt: "2026-07-31T10:00:04.000Z",
      stage: "primary_output_ready"
    });
    expect(exported.exports).toHaveLength(1);
    expect(reloadedExport.revision).toBe(exported.revision);
    expect(reloadedExport.updatedAt).toBe(exported.updatedAt);
    expect(reloadedExport.exports).toEqual(exported.exports);
  });

  it("increments every persisted Canva mutation but not handoff reads", async () => {
    await initializeProject(projectDir, {
      title: "Ocean Friends",
      theme: "ocean creatures",
      creatureCount: 1
    });
    await updateCreatureSelection(projectDir, [creature]);
    await approveCreatureSelection(projectDir);
    await acceptBookContent(projectDir, content);
    await seedIllustrations(projectDir);
    await generateDocuments(projectDir, ["docx"]);
    await acceptPrimaryOutput(projectDir);

    const ready = await setCanvaCapability(projectDir, { status: "ready" });
    expect(ready.revision).toBe(7);

    const selected = await selectCanvaDesign(projectDir, {
      designId: "playful-ocean",
      title: "Playful Ocean"
    });
    expect(selected.revision).toBe(8);

    const consented = await consentToCanva(projectDir, true);
    expect(consented.revision).toBe(9);

    await getCanvaHandoff(projectDir);
    expect((await loadProject(projectDir)).revision).toBe(9);

    const failed = await acceptCanvaResult(projectDir, {
      outcome: "failed",
      code: "timeout",
      message: "Connector timed out",
      retryable: true
    });
    expect(failed).toMatchObject({
      revision: 10,
      stage: "canva_failed",
      canva: { status: "failed", consentedAt: "2026-07-31T10:00:00.000Z", failure: { retryable: true } }
    });

    await getCanvaHandoff(projectDir);
    expect((await loadProject(projectDir)).revision).toBe(10);

    const completed = await acceptCanvaResult(projectDir, {
      outcome: "success",
      designId: "design-1",
      editUrl: "https://www.canva.com/design/design-1/edit"
    });
    expect(completed).toMatchObject({
      revision: 11,
      stage: "canva_complete",
      canva: { status: "complete" }
    });
    expect(completed.canva.failure).toBeUndefined();
    expect((await loadProject(projectDir)).revision).toBe(11);
  });

  it("allows two reworks, warns after each, and rejects a third", async () => {
    await initializeProject(projectDir, { title: "Ocean Friends", theme: "ocean creatures", creatureCount: 1 });
    await updateCreatureSelection(projectDir, [creature]);
    await approveCreatureSelection(projectDir);
    await acceptBookContent(projectDir, content);
    await seedIllustrations(projectDir);
    await generateDocuments(projectDir, ["docx"]);

    const first = await reworkPrimaryOutput(projectDir, {
      ...content,
      closingNote: "First revision"
    });
    expect(first).toMatchObject({ reworksRemaining: 1, warning: "Only one rework remains." });
    expect(first.project.primaryOutput.status).toBe("ready_for_review");

    const second = await reworkPrimaryOutput(projectDir, {
      ...content,
      closingNote: "Second revision"
    });
    expect(second).toMatchObject({ reworksRemaining: 0, warning: "No reworks remain." });
    await expect(reworkPrimaryOutput(projectDir, content)).rejects.toThrow(/maximum of two/i);
  });

  it("requires accepted current DOCX for secondary outputs and Canva", async () => {
    await initializeProject(projectDir, { title: "Ocean Friends", theme: "ocean creatures", creatureCount: 1 });
    await updateCreatureSelection(projectDir, [creature]);
    await approveCreatureSelection(projectDir);
    await acceptBookContent(projectDir, content);
    await seedIllustrations(projectDir);
    await generateDocuments(projectDir, ["docx"]);

    await expect(generateDocuments(projectDir, ["pptx"])).rejects.toThrow(/accept the current docx/i);
    await expect(setCanvaCapability(projectDir, { status: "ready" })).rejects.toThrow(/accept the current docx/i);
    await acceptPrimaryOutput(projectDir);
    const withPptx = await generateDocuments(projectDir, ["pptx"]);
    expect(withPptx).toMatchObject({ stage: "secondary_outputs_ready", primaryOutput: { status: "accepted" } });
    expect(withPptx.exports.map((record) => record.format)).toEqual(["docx", "pptx"]);
    expect(vi.mocked(exportSelectedFormats)).toHaveBeenLastCalledWith(
      content,
      expect.stringMatching(/[\\/]exports$/u),
      ["pptx"],
      expect.anything(),
      expect.objectContaining({ ensureDocx: false })
    );
    await expect(generateDocuments(projectDir, ["docx", "pdf"])).rejects.toThrow(/docx first/i);
  });

  it("iterates once at the selected age and then at the next age", async () => {
    await initializeProject(projectDir, { title: "Ocean Friends", theme: "ocean", ageBand: "6-8", creatureCount: 1 });
    await updateCreatureSelection(projectDir, [creature]);
    await approveCreatureSelection(projectDir);

    const first = await reiterateAuthoringPrompt(projectDir);
    expect(first.expectedOutput).toContain('effectiveAgeBand "6-8"');
    const second = await reiterateAuthoringPrompt(projectDir);
    expect(second.expectedOutput).toContain('effectiveAgeBand "9-11"');
    await expect(reiterateAuthoringPrompt(projectDir)).rejects.toThrow(/two poem iterations/i);
    expect((await loadProject(projectDir)).selection.regenerationsUsed).toBe(0);
  });

  it("persists DOCX and marks the project partially complete when optional PDF fails", async () => {
    await initializeProject(projectDir, { title: "Ocean Friends", theme: "ocean", creatureCount: 1, outputFormats: ["pdf"] });
    await updateCreatureSelection(projectDir, [creature]);
    await approveCreatureSelection(projectDir);
    await acceptBookContent(projectDir, content);
    await seedIllustrations(projectDir);
    vi.mocked(exportSelectedFormats).mockResolvedValueOnce({
      records: [{ format: "docx", relativePath: "ocean-friends.docx", sha256: "a".repeat(64), bytes: 1024, createdAt: new Date().toISOString() }],
      failures: [{ format: "pdf", code: "pdf_font_missing", message: "Font missing." }]
    });
    const exported = await generateDocuments(projectDir);
    expect(exported.stage).toBe("partially_complete");
    expect(exported.exports.map((record) => record.format)).toEqual(["docx"]);
    expect(exported.exportFailures).toEqual([{ format: "pdf", code: "pdf_font_missing", message: "Font missing." }]);
    expect((await loadProject(projectDir)).exportFailures).toEqual(exported.exportFailures);
  });
});
