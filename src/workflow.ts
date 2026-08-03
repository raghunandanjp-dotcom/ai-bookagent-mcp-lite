import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  bookContentSchema,
  creatureSchema,
  projectedPageCount,
  type BookContent
} from "./domain.ts";
import { checkCanvaReadiness, prepareCanvaHandoff, recordCanvaConsent, recordCanvaResult } from "./canva.ts";
import { exportSelectedFormats } from "./exporters.ts";
import { prepareAuthoringPrompts } from "./prompts.ts";
import {
  createProject,
  loadProject,
  resolveInside,
  saveProject,
  type BookProject
} from "./project.ts";
import { approveSelection, beginSelection } from "./selection.ts";
import { validateBookContent } from "./validation.ts";

type ProjectMutation = Partial<
  Pick<BookProject, "stage" | "selection" | "contentGeneration" | "content" | "exports" | "exportFailures" | "canva" | "sourceRevision" | "reworksUsed" | "primaryOutput">
>;

const MAX_REWORKS = 2;

function currentExports(project: BookProject) {
  return project.exports.filter((record) => record.sourceRevision === project.sourceRevision);
}

function requireAcceptedPrimary(project: BookProject): void {
  const docx = currentExports(project).find((record) => record.format === "docx");
  if (!docx || project.primaryOutput.status !== "accepted" ||
      project.primaryOutput.sourceRevision !== project.sourceRevision ||
      project.primaryOutput.sha256 !== docx.sha256) {
    throw new Error("Accept the current DOCX primary output before creating secondary outputs or starting Canva.");
  }
}

async function persistMutation(
  projectDir: string,
  project: BookProject,
  mutation: ProjectMutation
): Promise<BookProject> {
  return saveProject(projectDir, {
    ...project,
    ...mutation,
    revision: project.revision + 1
  });
}

export async function initializeProject(projectDir: string, request: unknown): Promise<BookProject> {
  const project = createProject(request);
  return saveProject(projectDir, project);
}

export async function updateCreatureSelection(
  projectDir: string,
  creaturesInput: unknown,
  excludePrevious = false
): Promise<BookProject> {
  const project = await loadProject(projectDir);
  const creatures = z.array(creatureSchema).parse(creaturesInput);
  const selection = beginSelection(creatures, project.selection, excludePrevious);
  return persistMutation(projectDir, project, {
    stage: "selection_review",
    selection,
    sourceRevision: project.sourceRevision + 1,
    content: undefined,
    primaryOutput: { status: "not_ready" },
    exportFailures: [],
    canva: { status: "not_checked" }
  });
}

export async function approveCreatureSelection(projectDir: string): Promise<BookProject> {
  const project = await loadProject(projectDir);
  return persistMutation(projectDir, project, {
    stage: "selection_approved",
    selection: approveSelection(project.selection)
  });
}

export async function createPromptPackage(projectDir: string) {
  const project = await loadProject(projectDir);
  if (!project.selection.approved) throw new Error("Approve the creature list before preparing content prompts.");
  const promptPackage = prepareAuthoringPrompts(project.request, project.selection.current, project.contentGeneration.currentAttempt);
  const promptDir = resolveInside(projectDir, "prompts");
  await mkdir(promptDir, { recursive: true });
  await writeFile(path.join(promptDir, "authoring-prompt-package.json"), `${JSON.stringify(promptPackage, null, 2)}\n`, "utf8");
  return promptPackage;
}

export async function reiterateAuthoringPrompt(projectDir: string) {
  const project = await loadProject(projectDir);
  if (!project.selection.approved) throw new Error("Approve the creature list before reiterating content.");
  if (project.contentGeneration.iterationsUsed >= 2) throw new Error("Only two poem iterations are permitted.");
  const attempt = (project.contentGeneration.iterationsUsed + 1) as 1 | 2;
  const updated = await persistMutation(projectDir, project, {
    contentGeneration: { iterationsUsed: attempt, currentAttempt: attempt }
  });
  return prepareAuthoringPrompts(updated.request, updated.selection.current, attempt);
}

export async function acceptBookContent(projectDir: string, contentInput: unknown) {
  const project = await loadProject(projectDir);
  if (!project.selection.approved) throw new Error("Approve the creature list before accepting book content.");
  const result = validateBookContent(contentInput, project.selection.current, project.request, project.contentGeneration.currentAttempt);
  const stage =
    !result.report.valid ? "content_review_required" :
    project.request.language === "kn" ? "language_review_required" :
    "content_review_required";
  const updated = await persistMutation(projectDir, project, {
    stage,
    content: result.content,
    sourceRevision: project.sourceRevision + 1,
    primaryOutput: { status: "not_ready" },
    exportFailures: [],
    canva: { status: "not_checked" }
  });
  return { project: updated, report: result.report };
}

export async function replaceCreatureContent(projectDir: string, creatureInput: unknown) {
  const project = await loadProject(projectDir);
  if (!project.content) throw new Error("Book content must exist before replacing one creature.");
  const replacement = bookContentSchema.shape.creatures.element.parse(creatureInput);
  if (!project.selection.current.some((creature) => creature.id === replacement.creatureId)) {
    throw new Error(`Creature ${replacement.creatureId} is not in the approved selection.`);
  }
  const existingIndex = project.content.creatures.findIndex(
    (creature) => creature.creatureId === replacement.creatureId
  );
  if (existingIndex < 0) throw new Error(`Creature ${replacement.creatureId} is missing from the current content.`);
  const creatures = [...project.content.creatures];
  creatures[existingIndex] = replacement;
  const content = { ...project.content, creatures };
  const validation = validateBookContent(content, project.selection.current, project.request);
  const updated = await persistMutation(projectDir, project, {
    stage: validation.report.valid
      ? project.request.language === "kn" ? "language_review_required" : "content_review_required"
      : "content_review_required",
    content,
    sourceRevision: project.sourceRevision + 1,
    primaryOutput: { status: "not_ready" },
    exportFailures: [],
    canva: { status: "not_checked" }
  });
  return { project: updated, affectedCreatureId: replacement.creatureId, report: validation.report };
}

export async function generateDocuments(
  projectDir: string,
  formats?: Array<"docx" | "pptx" | "pdf">
): Promise<BookProject> {
  const project = await loadProject(projectDir);
  const content: BookContent = bookContentSchema.parse(project.content);
  const validation = validateBookContent(content, project.selection.current, project.request);
  if (!validation.report.valid) throw new Error("Book content has blocking validation errors.");
  const requested = formats ?? ["docx"];
  if (requested.length === 0) throw new Error("Select at least one output format.");
  const secondary = requested.filter((format) => format !== "docx");
  if (secondary.length > 0 && requested.includes("docx")) {
    throw new Error("Generate and accept DOCX first, then request PPTX and/or PDF as secondary outputs.");
  }
  if (secondary.length > 0) requireAcceptedPrimary(project);
  const exportDir = resolveInside(projectDir, "exports");
  const result = await exportSelectedFormats(content, exportDir, requested, {
    ageBand: content.effectiveAgeBand,
    language: project.request.language,
    ensureDocx: secondary.length === 0
  });
  if (secondary.length === 0 && !result.records.some((record) => record.format === "docx")) {
    const failure = result.failures.find((item) => item.format === "docx");
    throw new Error(failure?.message ?? "Mandatory DOCX export failed.");
  }
  const records = result.records.map((record) => ({
    ...record,
    sourceRevision: project.sourceRevision
  }));
  const replacedFormats = new Set(records.map((record) => record.format));
  const exports = [
    ...project.exports.filter((record) => record.sourceRevision !== project.sourceRevision || !replacedFormats.has(record.format)),
    ...records
  ];
  const docx = records.find((record) => record.format === "docx");
  return persistMutation(projectDir, project, {
    stage: result.failures.length > 0 ? "partially_complete" : docx ? "primary_output_ready" : "secondary_outputs_ready",
    exports,
    exportFailures: result.failures,
    ...(docx ? {
      primaryOutput: {
        status: "ready_for_review" as const,
        sourceRevision: project.sourceRevision,
        sha256: docx.sha256,
        relativePath: docx.relativePath
      },
      canva: { status: "not_checked" as const }
    } : {})
  });
}

export async function acceptPrimaryOutput(projectDir: string, note?: string): Promise<BookProject> {
  const project = await loadProject(projectDir);
  const docx = currentExports(project).find((record) => record.format === "docx");
  if (!docx || project.primaryOutput.status !== "ready_for_review" || project.primaryOutput.sha256 !== docx.sha256) {
    throw new Error("Generate and review the current DOCX before accepting the primary output.");
  }
  return persistMutation(projectDir, project, {
    stage: "primary_output_accepted",
    primaryOutput: {
      ...project.primaryOutput,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      note
    }
  });
}

export async function reworkPrimaryOutput(projectDir: string, contentInput: unknown) {
  const project = await loadProject(projectDir);
  if (project.primaryOutput.status !== "ready_for_review") {
    throw new Error("A DOCX awaiting review is required before requesting rework.");
  }
  if (project.reworksUsed >= MAX_REWORKS) throw new Error("The maximum of two primary-output reworks has been used.");
  const validation = validateBookContent(contentInput, project.selection.current, project.request);
  if (!validation.report.valid || !validation.content) throw new Error("Reworked content has blocking validation errors.");
  const sourceRevision = project.sourceRevision + 1;
  const exportDir = resolveInside(projectDir, "exports");
  const result = await exportSelectedFormats(validation.content, exportDir, ["docx"], {
    ageBand: validation.content.effectiveAgeBand,
    language: project.request.language
  });
  const docxRecord = result.records.find((record) => record.format === "docx");
  if (!docxRecord) {
    const failure = result.failures.find((item) => item.format === "docx");
    throw new Error(failure?.message ?? "Mandatory DOCX export failed.");
  }
  const docx = {
    ...docxRecord,
    sourceRevision
  };
  const updated = await persistMutation(projectDir, project, {
    stage: "primary_output_ready",
    sourceRevision,
    reworksUsed: project.reworksUsed + 1,
    content: validation.content,
    exports: [...project.exports, docx],
    exportFailures: result.failures,
    primaryOutput: {
      status: "ready_for_review",
      sourceRevision,
      sha256: docx.sha256,
      relativePath: docx.relativePath
    },
    canva: { status: "not_checked" }
  });
  return {
    project: updated,
    report: validation.report,
    reworksRemaining: MAX_REWORKS - updated.reworksUsed,
    warning: updated.reworksUsed === 1 ? "Only one rework remains." : "No reworks remain."
  };
}

export async function setCanvaCapability(projectDir: string, capability: unknown): Promise<BookProject> {
  const project = await loadProject(projectDir);
  requireAcceptedPrimary(project);
  const canva = checkCanvaReadiness(capability);
  const stage = canva.status === "setup_required" ? "canva_setup_required" : "canva_design_selection_required";
  return persistMutation(projectDir, project, { stage, canva });
}

export async function selectCanvaDesign(
  projectDir: string,
  design: { designId: string; title: string; templateUrl?: string }
): Promise<BookProject> {
  const project = await loadProject(projectDir);
  requireAcceptedPrimary(project);
  if (project.canva.status !== "design_selection_required" && project.canva.status !== "ready_for_consent") {
    throw new Error("Check Canva readiness before selecting a design.");
  }
  if (!design.designId.trim() || !design.title.trim()) throw new Error("A Canva design ID and title are required.");
  return persistMutation(projectDir, project, {
    stage: "canva_consent_required",
    canva: {
      status: "ready_for_consent",
      readiness: project.canva.readiness,
      checkedAt: project.canva.checkedAt,
      adapter: project.canva.adapter,
      selection: {
        ...design,
        selectedAt: new Date().toISOString(),
        sourceRevision: project.sourceRevision
      },
      sourceRevision: project.sourceRevision
    }
  });
}

export async function consentToCanva(projectDir: string, consent: boolean): Promise<BookProject> {
  const project = await loadProject(projectDir);
  if (project.canva.status !== "ready_for_consent") throw new Error("Canva must be ready before consent is recorded.");
  if (!project.canva.selection || project.canva.selection.sourceRevision !== project.sourceRevision) {
    throw new Error("Select a Canva design for the current accepted DOCX before recording consent.");
  }
  const consentState = recordCanvaConsent(consent);
  return persistMutation(projectDir, project, {
    stage: consent ? "canva_consent_required" : "canva_declined",
    canva: {
      ...project.canva,
      ...consentState,
      consentedAt: consentState.consentedAt,
      declinedAt: consentState.declinedAt
    }
  });
}

export async function getCanvaHandoff(projectDir: string) {
  const project = await loadProject(projectDir);
  if (!project.content) throw new Error("Validated content is required.");
  requireAcceptedPrimary(project);
  return prepareCanvaHandoff(project.projectId, project.revision, project.request, project.content, project.canva);
}

export async function acceptCanvaResult(projectDir: string, result: unknown): Promise<BookProject> {
  const project = await loadProject(projectDir);
  if (project.canva.status !== "consented" &&
      !(project.canva.status === "failed" && project.canva.failure?.retryable && project.canva.consentedAt)) {
    throw new Error("Canva consent is required before recording a result.");
  }
  const resultState = recordCanvaResult(result);
  return persistMutation(projectDir, project, {
    stage: resultState.status === "complete" ? "canva_complete" : "canva_failed",
    canva: {
      ...project.canva,
      ...resultState,
      failure: resultState.status === "complete" ? undefined : resultState.failure,
      designId: resultState.status === "complete" ? resultState.designId : undefined,
      editUrl: resultState.status === "complete" ? resultState.editUrl : undefined,
      sourceRevision: project.sourceRevision
    }
  });
}

export function deliverySummary(project: BookProject) {
  const validation = project.content
    ? validateBookContent(project.content, project.selection.current, project.request)
    : undefined;
  const contentReviewIssues = validation?.report.issues
    .filter((issue) => issue.level === "warning" && issue.code !== "kannada_pptx_font_required")
    .map(({ code, path, message }) => ({ code, path, message })) ?? [];
  const currentFormats = new Set(currentExports(project).map((record) => record.format));
  const nextActions: string[] = [];
  if (project.primaryOutput.status === "ready_for_review") {
    if (project.reworksUsed < MAX_REWORKS) nextActions.push("rework_primary_output");
    nextActions.push("accept_primary_output");
  } else if (project.primaryOutput.status === "accepted") {
    if (!currentFormats.has("pptx")) nextActions.push("create_pptx");
    if (!currentFormats.has("pdf")) nextActions.push("create_pdf");
    if (["not_checked", "setup_required", "declined"].includes(project.canva.status)) nextActions.push("start_canva");
    if (project.canva.status === "design_selection_required") nextActions.push("select_canva_design");
    if (project.canva.status === "ready_for_consent") nextActions.push("confirm_canva_handoff");
    if (project.canva.status === "consented") nextActions.push("prepare_canva_handoff");
    if (project.canva.status === "failed") {
      if (project.canva.failure?.retryable) nextActions.push("prepare_canva_handoff");
      nextActions.push("start_canva");
    }
  }

  return {
    projectId: project.projectId,
    revision: project.revision,
    sourceRevision: project.sourceRevision,
    reworks: { used: project.reworksUsed, remaining: Math.max(0, MAX_REWORKS - project.reworksUsed) },
    title: project.request.title,
    stage: project.stage,
    creaturesCovered: project.content?.creatures.map((creature) => creature.displayName) ?? [],
    sectionsPerCreature: ["poem", "fun fact", "activity"],
    pageCount: project.content ? projectedPageCount(project.content) : 0,
    language: project.request.language,
    selectedAgeBand: project.request.ageBand,
    effectiveAgeBand: project.content?.effectiveAgeBand ?? project.request.ageBand,
    generationAttempt: project.contentGeneration.currentAttempt,
    languageReviewRequired: project.request.language === "kn",
    review: {
      language: {
        status: project.request.language === "kn" ? "required" : "not_required"
      },
      content: {
        status: !project.content
          ? "not_available"
          : contentReviewIssues.length > 0 ? "required" : "complete",
        outstandingCount: contentReviewIssues.length,
        issues: contentReviewIssues
      }
    },
    primaryOutput: project.primaryOutput,
    exports: currentExports(project),
    staleExports: project.exports.filter((record) => record.sourceRevision !== project.sourceRevision),
    exportFailures: project.exportFailures,
    canva: project.canva,
    nextActions,
    localDeliveryComplete: project.primaryOutput.status === "accepted",
    deliveryComplete: project.primaryOutput.status === "accepted" &&
      ["not_checked", "declined", "complete"].includes(project.canva.status)
  };
}
