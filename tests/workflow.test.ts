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
  setCanvaCapability,
  updateCreatureSelection
} from "../src/workflow.ts";
import { loadProject } from "../src/project.ts";

vi.mock("../src/exporters.ts", () => ({
  exportSelectedFormats: vi.fn(async (_content, _dir, formats: Array<"docx" | "pptx" | "pdf">) =>
    formats.map((format) => ({
      format,
      relativePath: `ocean-friends.${format}`,
      sha256: format[0].repeat(64),
      bytes: 1024,
      createdAt: new Date().toISOString()
    })))
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
  schemaVersion: "1.0" as const,
  title: "Ocean Friends",
  language: "en" as const,
  creatures: [{
    creatureId: "octopus",
    displayName: "Octopus",
    poem: section("Eight arms wave beneath the sea."),
    funFact: section("An octopus has three hearts."),
    activity: section("Draw and count eight octopus arms."),
    illustrationBrief: "A friendly octopus near coral.",
    altText: "A smiling octopus with eight visible arms."
  }]
};

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

    vi.setSystemTime(new Date("2026-07-31T10:00:04.000Z"));
    const exported = await generateDocuments(projectDir, ["docx"]);
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
    await generateDocuments(projectDir, ["docx"]);
    await acceptPrimaryOutput(projectDir);

    const ready = await setCanvaCapability(projectDir, { available: true });
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

    const completed = await acceptCanvaResult(projectDir, {
      designId: "design-1",
      editUrl: "https://www.canva.com/design/design-1"
    });
    expect(completed).toMatchObject({
      revision: 10,
      stage: "canva_complete",
      canva: { status: "complete" }
    });
    expect((await loadProject(projectDir)).revision).toBe(10);
  });

  it("allows two reworks, warns after each, and rejects a third", async () => {
    await initializeProject(projectDir, { title: "Ocean Friends", theme: "ocean creatures", creatureCount: 1 });
    await updateCreatureSelection(projectDir, [creature]);
    await approveCreatureSelection(projectDir);
    await acceptBookContent(projectDir, content);
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
    await generateDocuments(projectDir, ["docx"]);

    await expect(generateDocuments(projectDir, ["pptx"])).rejects.toThrow(/accept the current docx/i);
    await expect(setCanvaCapability(projectDir, { available: true })).rejects.toThrow(/accept the current docx/i);
    await acceptPrimaryOutput(projectDir);
    await expect(generateDocuments(projectDir, ["pptx"])).resolves.toMatchObject({ stage: "secondary_outputs_ready" });
  });
});
