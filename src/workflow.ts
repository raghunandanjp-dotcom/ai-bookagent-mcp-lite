import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  bookContentSchema,
  creatureSchema,
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
  Pick<BookProject, "stage" | "selection" | "content" | "exports" | "canva">
>;

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
    content: undefined,
    exports: [],
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
  const promptPackage = prepareAuthoringPrompts(project.request, project.selection.current);
  const promptDir = resolveInside(projectDir, "prompts");
  await mkdir(promptDir, { recursive: true });
  await writeFile(path.join(promptDir, "authoring-prompt-package.json"), `${JSON.stringify(promptPackage, null, 2)}\n`, "utf8");
  return promptPackage;
}

export async function acceptBookContent(projectDir: string, contentInput: unknown) {
  const project = await loadProject(projectDir);
  if (!project.selection.approved) throw new Error("Approve the creature list before accepting book content.");
  const result = validateBookContent(contentInput, project.selection.current);
  const stage =
    !result.report.valid ? "content_review_required" :
    project.request.language === "kn" ? "language_review_required" :
    "content_review_required";
  const updated = await persistMutation(projectDir, project, {
    stage,
    content: result.content,
    exports: [],
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
  const validation = validateBookContent(content, project.selection.current);
  const updated = await persistMutation(projectDir, project, {
    stage: validation.report.valid
      ? project.request.language === "kn" ? "language_review_required" : "content_review_required"
      : "content_review_required",
    content,
    exports: [],
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
  const validation = validateBookContent(content, project.selection.current);
  if (!validation.report.valid) throw new Error("Book content has blocking validation errors.");
  const exportDir = resolveInside(projectDir, "exports");
  const records = await exportSelectedFormats(content, exportDir, formats ?? project.request.outputFormats);
  return persistMutation(projectDir, project, {
    stage: "documents_ready",
    exports: records
  });
}

export async function setCanvaCapability(projectDir: string, capability: unknown): Promise<BookProject> {
  const project = await loadProject(projectDir);
  if (!project.exports.some((record) => record.format === "docx")) {
    throw new Error("Generate the mandatory DOCX before checking Canva.");
  }
  const canva = checkCanvaReadiness(capability);
  const stage = canva.status === "setup_required" ? "canva_setup_required" : "canva_consent_required";
  return persistMutation(projectDir, project, { stage, canva });
}

export async function consentToCanva(projectDir: string, consent: boolean): Promise<BookProject> {
  const project = await loadProject(projectDir);
  if (project.canva.status !== "ready_for_consent") throw new Error("Canva must be ready before consent is recorded.");
  return persistMutation(projectDir, project, {
    canva: recordCanvaConsent(consent)
  });
}

export async function getCanvaHandoff(projectDir: string) {
  const project = await loadProject(projectDir);
  if (!project.content) throw new Error("Validated content is required.");
  return prepareCanvaHandoff(project.request, project.content, project.canva);
}

export async function acceptCanvaResult(projectDir: string, result: unknown): Promise<BookProject> {
  const project = await loadProject(projectDir);
  if (project.canva.status !== "consented") throw new Error("Canva consent is required before recording a result.");
  return persistMutation(projectDir, project, {
    stage: "canva_complete",
    canva: recordCanvaResult(result)
  });
}

export function deliverySummary(project: BookProject) {
  const validation = project.content
    ? validateBookContent(project.content, project.selection.current)
    : undefined;
  const contentReviewIssues = validation?.report.issues
    .filter((issue) => issue.level === "warning")
    .map(({ code, path, message }) => ({ code, path, message })) ?? [];

  return {
    projectId: project.projectId,
    revision: project.revision,
    title: project.request.title,
    stage: project.stage,
    creaturesCovered: project.content?.creatures.map((creature) => creature.displayName) ?? [],
    sectionsPerCreature: ["poem", "fun fact", "activity"],
    pageCount: project.content ? 1 + project.content.creatures.length * 3 : 0,
    language: project.request.language,
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
    exports: project.exports,
    canva: project.canva
  };
}
