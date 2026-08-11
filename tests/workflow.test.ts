import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptBookContent,
  acceptCanvaResult,
  acceptPrimaryOutput,
  approveCreatureSelection,
  approveBookDesign,
  consentToCanva,
  createPromptPackage,
  generateDocuments,
  getCanvaHandoff,
  initializeProject,
  reworkPrimaryOutput,
  replaceClosingNote,
  replaceCreatureContent,
  selectCanvaDesign,
  reiterateAuthoringPrompt,
  setCanvaCapability,
  updateCreatureSelection
} from "../src/workflow.ts";
import { loadProject, saveProject } from "../src/project.ts";
import { exportSelectedFormats } from "../src/exporters.ts";
import { fixtureIllustrations } from "./fixtures/illustrations.ts";
import { buildBookDesign } from "../src/design.ts";

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
  const review = { approvedAt: new Date().toISOString(), approvedBy: "Test reviewer" };
  const design = { ...buildBookDesign(content, assets, project.sourceRevision, 1), status: "approved" as const, ...review };
  await saveProject(projectDir, { ...project, illustrations: assets, design, stage: "design_approved" });
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

  it("rejects mojibake creature replacements without changing persisted project bytes", async () => {
    await initializeProject(projectDir, { title: "Ocean Friends", theme: "ocean creatures", creatureCount: 1 });
    await updateCreatureSelection(projectDir, [creature]);
    await approveCreatureSelection(projectDir);
    await acceptBookContent(projectDir, content);
    const before = await loadProject(projectDir);
    const beforeBytes = await readFile(path.join(projectDir, "book-project.json"));
    const replacement = structuredClone(content.creatures[0]!);
    replacement.funFact.text = "An octopus\u00C3\u00A2\u00E2\u201A\u00AC\u00E2\u201E\u00A2s three hearts are remarkable.";

    await expect(replaceCreatureContent(projectDir, replacement)).rejects.toThrow(/encoding corruption.*funFact\.text/i);

    const after = await loadProject(projectDir);
    const afterBytes = await readFile(path.join(projectDir, "book-project.json"));
    expect(after).toMatchObject({ revision: before.revision, sourceRevision: before.sourceRevision });
    expect(after.content).toEqual(before.content);
    expect(afterBytes).toEqual(beforeBytes);
  });

  it("permits sequential correction of historical mojibake in multiple creatures", async () => {
    const seahorse = { ...creature, id: "seahorse", name: "Seahorse" };
    const historicalContent = structuredClone(content);
    historicalContent.creatures.push({
      ...structuredClone(content.creatures[0]!),
      creatureId: "seahorse",
      displayName: "Seahorse"
    });
    historicalContent.creatures[0]!.funFact.text = "An octopus\u00C3\u00A2\u00E2\u201A\u00AC\u00E2\u201E\u00A2s three hearts are remarkable.";
    historicalContent.creatures[1]!.funFact.text = "A seahorse\u00C3\u00A2\u00E2\u201A\u00AC\u00E2\u201E\u00A2s tail can grip sea grass.";

    await initializeProject(projectDir, { title: "Ocean Friends", theme: "ocean creatures", creatureCount: 2 });
    await updateCreatureSelection(projectDir, [creature, seahorse]);
    await approveCreatureSelection(projectDir);
    await acceptBookContent(projectDir, historicalContent);

    const firstReplacement = structuredClone(content.creatures[0]!);
    const first = await replaceCreatureContent(projectDir, firstReplacement);
    expect(first.report.issues.filter((issue) => issue.code === "content_encoding_mojibake")).toEqual([
      expect.objectContaining({ path: "creatures.1.funFact.text" })
    ]);
    expect(first.project).toMatchObject({ revision: 5, sourceRevision: 4 });

    const secondReplacement = structuredClone(historicalContent.creatures[1]!);
    secondReplacement.funFact.text = "A seahorse's tail can grip sea grass.";
    const second = await replaceCreatureContent(projectDir, secondReplacement);
    expect(second.report.issues.filter((issue) => issue.code === "content_encoding_mojibake")).toEqual([]);
    expect(second.project).toMatchObject({ revision: 6, sourceRevision: 5 });
    expect((await loadProject(projectDir)).content).toEqual(second.project.content);
  });

  it("rejects a new encoding-error path while preserving a historically corrupted project byte-for-byte", async () => {
    const seahorse = { ...creature, id: "seahorse", name: "Seahorse" };
    const historicalContent = structuredClone(content);
    historicalContent.creatures.push({
      ...structuredClone(content.creatures[0]!),
      creatureId: "seahorse",
      displayName: "Seahorse"
    });
    historicalContent.creatures[0]!.funFact.text = "An octopus\u00C3\u00A2\u00E2\u201A\u00AC\u00E2\u201E\u00A2s three hearts are remarkable.";
    historicalContent.creatures[1]!.funFact.text = "A seahorse\u00C3\u00A2\u00E2\u201A\u00AC\u00E2\u201E\u00A2s tail can grip sea grass.";

    await initializeProject(projectDir, { title: "Ocean Friends", theme: "ocean creatures", creatureCount: 2 });
    await updateCreatureSelection(projectDir, [creature, seahorse]);
    await approveCreatureSelection(projectDir);
    await acceptBookContent(projectDir, historicalContent);
    const before = await loadProject(projectDir);
    const beforeBytes = await readFile(path.join(projectDir, "book-project.json"));
    const replacement = structuredClone(content.creatures[0]!);
    replacement.altText = "An octopus\u00C3\u00A2\u00E2\u201A\u00AC\u00E2\u201E\u00A2s arms wave near coral.";

    await expect(replaceCreatureContent(projectDir, replacement)).rejects.toThrow(
      /encoding corruption at: creatures\.0\.altText\.$/i
    );

    const after = await loadProject(projectDir);
    const afterBytes = await readFile(path.join(projectDir, "book-project.json"));
    expect(after).toMatchObject({ revision: before.revision, sourceRevision: before.sourceRevision });
    expect(after.content).toEqual(before.content);
    expect(afterBytes).toEqual(beforeBytes);
  });

  it("replaces only the closing note, advances revisions, and makes prior design and outputs stale without consuming allowances", async () => {
    const originalContent = { ...content, closingNote: "Every creature helps its neighbors." };
    await initializeProject(projectDir, { title: "Ocean Friends", theme: "ocean creatures", creatureCount: 1 });
    await updateCreatureSelection(projectDir, [creature]);
    await approveCreatureSelection(projectDir);
    await acceptBookContent(projectDir, originalContent);
    await seedIllustrations(projectDir);
    const designed = await loadProject(projectDir);
    await saveProject(projectDir, {
      ...designed,
      designPreview: {
        relativePath: "previews/book-design.html",
        sha256: "a".repeat(64),
        bytes: 42,
        createdAt: "2026-07-31T10:00:00.000Z",
        designRevision: designed.design!.designRevision
      }
    });
    await generateDocuments(projectDir, ["docx"]);
    const before = await loadProject(projectDir);
    expect(before.designPreview).toBeDefined();

    const result = await replaceClosingNote(
      projectDir,
      "  Ocean creatures have many special ways of living, moving, and sharing their habitats.  "
    );
    const after = await loadProject(projectDir);
    const replacement = "Ocean creatures have many special ways of living, moving, and sharing their habitats.";

    expect(result).toMatchObject({ affectedField: "closingNote", project: { revision: before.revision + 1, sourceRevision: before.sourceRevision + 1 } });
    expect(after).toEqual({
      ...before,
      revision: before.revision + 1,
      sourceRevision: before.sourceRevision + 1,
      updatedAt: after.updatedAt,
      stage: "content_review_required",
      content: { ...before.content!, closingNote: replacement },
      designPreview: undefined,
      primaryOutput: { status: "not_ready" },
      exportFailures: [],
      canva: { status: "not_checked" }
    });
    expect(after.contentGeneration).toEqual(before.contentGeneration);
    expect(after.reworksUsed).toBe(before.reworksUsed);
    expect(after.design).toEqual(before.design);
    expect(after.design!.sourceRevision).toBe(before.sourceRevision);
    expect(after.design!.sourceRevision).not.toBe(after.sourceRevision);
    expect(after.exports).toEqual(before.exports);
    expect(after.exports.every((record) => record.sourceRevision !== after.sourceRevision)).toBe(true);
  });

  it.each([
    ["non-string", { text: "Not a string" }],
    ["empty", "   "],
    ["oversized", "x".repeat(241)],
    ["mojibake", "Ocean creatures\u00C3\u00A2\u00E2\u201A\u00AC\u00E2\u201E\u00A2 habitats are shared."]
  ])("rejects %s closing-note correction with byte-identical project state", async (_case, replacement) => {
    await initializeProject(projectDir, { title: "Ocean Friends", theme: "ocean creatures", creatureCount: 1 });
    await updateCreatureSelection(projectDir, [creature]);
    await approveCreatureSelection(projectDir);
    await acceptBookContent(projectDir, { ...content, closingNote: "Original closing note." });
    const beforeBytes = await readFile(path.join(projectDir, "book-project.json"));
    const before = await loadProject(projectDir);

    await expect(replaceClosingNote(projectDir, replacement)).rejects.toThrow();

    expect(await readFile(path.join(projectDir, "book-project.json"))).toEqual(beforeBytes);
    expect(await loadProject(projectDir)).toEqual(before);
  });

  it("rejects a wrong-script closing note for a Kannada project with byte-identical state and counters", async () => {
    const kannadaSection = (text: string) => ({
      text,
      language: "kn" as const,
      reviewStatus: "needs_review" as const
    });
    const kannadaContent = {
      ...content,
      title: "ಸಮುದ್ರ ಸ್ನೇಹಿತರು",
      language: "kn" as const,
      closingNote: "ಸಮುದ್ರ ಜೀವಿಗಳೊಂದಿಗೆ ಹಂಚಿಕೊಳ್ಳುತ್ತಾ ಕಲಿಯಿರಿ.",
      creatures: [{
        ...content.creatures[0]!,
        displayName: "ಆಕ್ಟೋಪಸ್",
        poem: {
          ...kannadaSection("ಎಂಟು ಕೈಗಳು ನೀರಿನಲ್ಲಿ ಅಲೆಯುತ್ತವೆ\nಬಣ್ಣದ ಹವಳದ ಬಳಿ ಕುಣಿಯುತ್ತವೆ\nಸಮುದ್ರದ ಅಲೆಯಲ್ಲಿ ಮೆಲ್ಲಗೆ ಸಾಗುತ್ತವೆ\n\nಮೀನುಗಳ ಜೊತೆಗೆ ಸಂತಸ ಹಂಚುತ್ತವೆ\nನೀಲಿ ನೀರಿನಲ್ಲಿ ಚೆನ್ನಾಗಿ ಈಜುತ್ತವೆ\nಆಕ್ಟೋಪಸ್ ಎಲ್ಲರಿಗೂ ಕೈ ಬೀಸುತ್ತದೆ"),
          title: "ಅಲೆಯುವ ಕೈಗಳು",
          structureVersion: "1.0" as const,
          rhymeScheme: "AAB" as const
        },
        funFact: kannadaSection("ಆಕ್ಟೋಪಸ್‌ಗೆ ಮೂರು ಹೃದಯಗಳಿವೆ."),
        activity: kannadaSection("ಆಕ್ಟೋಪಸ್‌ನ ಎಂಟು ಕೈಗಳನ್ನು ಚಿತ್ರಿಸಿ ಎಣಿಸಿ.")
      }]
    };
    await initializeProject(projectDir, {
      title: "ಸಮುದ್ರ ಸ್ನೇಹಿತರು",
      theme: "ಸಮುದ್ರ ಜೀವಿಗಳು",
      ageBand: "6-8",
      language: "kn",
      creatureCount: 1
    });
    await updateCreatureSelection(projectDir, [creature]);
    await approveCreatureSelection(projectDir);
    const accepted = await acceptBookContent(projectDir, kannadaContent);
    expect(accepted.report.valid).toBe(true);
    const before = await loadProject(projectDir);
    const beforeBytes = await readFile(path.join(projectDir, "book-project.json"));

    await expect(replaceClosingNote(projectDir, "Keep sharing the ocean.")).rejects.toThrow(/Kannada content must contain Kannada script/i);

    const after = await loadProject(projectDir);
    expect(await readFile(path.join(projectDir, "book-project.json"))).toEqual(beforeBytes);
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      revision: before.revision,
      sourceRevision: before.sourceRevision,
      reworksUsed: before.reworksUsed,
      contentGeneration: before.contentGeneration
    });
  });

  it("requires generated content before closing-note correction and preserves project bytes on failure", async () => {
    await initializeProject(projectDir, { title: "Ocean Friends", theme: "ocean creatures", creatureCount: 1 });
    const beforeBytes = await readFile(path.join(projectDir, "book-project.json"));

    await expect(replaceClosingNote(projectDir, "A valid closing note.")).rejects.toThrow(/content must exist/i);

    expect(await readFile(path.join(projectDir, "book-project.json"))).toEqual(beforeBytes);
  });

  it("does not persist repeated identical creature-selection submissions", async () => {
    const creatures = ["octopus", "orca", "seal", "walrus", "dolphin"].map((id) => ({
      ...creature,
      id,
      name: id
    }));
    await initializeProject(projectDir, {
      title: "Ocean Friends",
      theme: "ocean creatures",
      creatureCount: creatures.length
    });
    await updateCreatureSelection(projectDir, creatures);
    const approved = await approveCreatureSelection(projectDir);

    const firstRetry = await updateCreatureSelection(projectDir, creatures.map((item) => ({ ...item })));
    const secondRetry = await updateCreatureSelection(projectDir, creatures.map((item) => ({ ...item })));

    expect(firstRetry).toEqual(approved);
    expect(secondRetry).toEqual(approved);
    expect(secondRetry).toMatchObject({
      revision: 3,
      sourceRevision: 2,
      stage: "selection_approved",
      selection: { approved: true, regenerationsUsed: 0 }
    });
    expect(secondRetry.selection.history).toHaveLength(1);
    expect(await loadProject(projectDir)).toEqual(approved);
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
      editUrl: "https://www.canva.com/design/design-1/edit",
      sourceRevision: failed.sourceRevision,
      designRevision: failed.design!.designRevision,
      illustrationSetDigest: failed.design!.illustrationSetDigest,
      pageCount: failed.design!.pages.length
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
    expect(first.project).toMatchObject({ stage: "design_review_required", primaryOutput: { status: "not_ready" }, design: { status: "ready_for_review", designRevision: 2 } });
    await approveBookDesign(projectDir, "Test reviewer");
    await generateDocuments(projectDir, ["docx"]);

    const second = await reworkPrimaryOutput(projectDir, {
      ...content,
      closingNote: "Second revision"
    });
    expect(second).toMatchObject({ reworksRemaining: 0, warning: "No reworks remain." });
    await expect(reworkPrimaryOutput(projectDir, content)).rejects.toThrow(/maximum of two/i);
  });

  it("creates a fresh design review and does not export stale layout during rework", async () => {
    await initializeProject(projectDir, { title: "Ocean Friends", theme: "ocean creatures", creatureCount: 1 });
    await updateCreatureSelection(projectDir, [creature]);
    await approveCreatureSelection(projectDir);
    await acceptBookContent(projectDir, content);
    await seedIllustrations(projectDir);
    await generateDocuments(projectDir, ["docx"]);
    vi.mocked(exportSelectedFormats).mockClear();
    const result = await reworkPrimaryOutput(projectDir, { ...content, closingNote: "Revised" });
    expect(exportSelectedFormats).not.toHaveBeenCalled();
    expect(result.project).toMatchObject({
      reworksUsed: 1,
      stage: "design_review_required",
      primaryOutput: { status: "not_ready" },
      design: { status: "ready_for_review", designRevision: 2 }
    });
    expect(result.project.design!.sourceRevision).toBe(result.project.sourceRevision);
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
