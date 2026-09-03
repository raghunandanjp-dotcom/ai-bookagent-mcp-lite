import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  bookContentSchema,
  bookRequestSchema,
  humanApprovedAlternativeRhymeSchemeSchema,
  illustrationAssetSchema,
  selectionStateSchema,
  type BookContent,
  type BookRequest,
  type IllustrationAsset,
  type HumanApprovedAlternativeRhymeScheme,
  type SelectionState
} from "./domain.ts";
import { bookDesignSchema, type BookDesign } from "./design.ts";

export const PROJECT_SCHEMA_VERSION = "1.2";

function requireAbsoluteProjectDir(projectDir: string): void {
  if (!path.isAbsolute(projectDir)) {
    throw new Error(
      "Project directory must be an absolute path. Select an explicit location before calling this tool."
    );
  }
}

export type ProjectStage =
  | "draft"
  | "selection_review"
  | "selection_approved"
  | "content_review_required"
  | "language_review_required"
  | "illustration_review_required"
  | "illustrations_ready"
  | "design_review_required"
  | "design_approved"
  | "documents_ready"
  | "primary_output_ready"
  | "primary_output_accepted"
  | "secondary_outputs_ready"
  | "canva_setup_required"
  | "canva_design_selection_required"
  | "canva_consent_required"
  | "canva_declined"
  | "canva_failed"
  | "canva_complete"
  | "partially_complete"
  | "failed";

export interface ExportRecord {
  format: "docx" | "pptx" | "pdf";
  relativePath: string;
  sha256: string;
  bytes: number;
  createdAt: string;
  sourceRevision?: number;
  designRevision?: number;
  illustrationSetDigest?: string;
  warnings?: string[];
}

export interface PrimaryOutputAcceptance {
  status: "not_ready" | "ready_for_review" | "accepted";
  sourceRevision?: number;
  designRevision?: number;
  illustrationSetDigest?: string;
  sha256?: string;
  relativePath?: string;
  acceptedAt?: string;
  note?: string;
}

export interface CanvaDesignSelection {
  designId: string;
  title: string;
  templateUrl?: string;
  selectedAt: string;
  sourceRevision: number;
  designRevision?: number;
}

export interface CanvaPendingImport {
  jobId: string;
  sourceRevision: number;
  designRevision: number;
  illustrationSetDigest: string;
  pageCount: number;
  pptxSha256: string;
  startedAt: string;
}

export interface ExportFailure {
  format: "docx" | "pptx" | "pdf";
  code: string;
  message: string;
}

export interface CanvaState {
  status: "not_checked" | "setup_required" | "design_selection_required" | "ready_for_consent" | "declined" | "consented" | "complete" | "failed";
  readiness?: "ready" | "unavailable" | "authorization_required";
  checkedAt?: string;
  adapter?: { connectorName?: string; toolName?: string };
  setupInstructions?: string[];
  consentedAt?: string;
  declinedAt?: string;
  designId?: string;
  editUrl?: string;
  connectorUrl?: string;
  failure?: { code: string; message: string; retryable: boolean; failedAt: string };
  selection?: CanvaDesignSelection;
  pendingImport?: CanvaPendingImport;
  sourceRevision?: number;
  designRevision?: number;
  illustrationSetDigest?: string;
}

const canvaStateSchema = z.object({
  status: z.enum(["not_checked", "setup_required", "design_selection_required", "ready_for_consent", "declined", "consented", "complete", "failed"]),
  readiness: z.enum(["ready", "unavailable", "authorization_required"]).optional(),
  checkedAt: z.string().datetime().optional(),
  adapter: z.object({ connectorName: z.string().min(1).optional(), toolName: z.string().min(1).optional() }).optional(),
  setupInstructions: z.array(z.string().min(1)).optional(),
  consentedAt: z.string().datetime().optional(),
  declinedAt: z.string().datetime().optional(),
  designId: z.string().min(1).optional(),
  editUrl: z.string().url().optional(),
  connectorUrl: z.string().url().optional(),
  failure: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    failedAt: z.string().datetime()
  }).optional(),
  selection: z.object({
    designId: z.string().min(1),
    title: z.string().min(1),
    templateUrl: z.string().url().optional(),
    selectedAt: z.string().datetime(),
    sourceRevision: z.number().int().positive(),
    designRevision: z.number().int().positive().optional()
  }).optional(),
  pendingImport: z.object({
    jobId: z.string().min(1),
    sourceRevision: z.number().int().positive(),
    designRevision: z.number().int().positive(),
    illustrationSetDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    pageCount: z.number().int().positive(),
    pptxSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    startedAt: z.string().datetime()
  }).optional(),
  sourceRevision: z.number().int().positive().optional(),
  designRevision: z.number().int().positive().optional(),
  illustrationSetDigest: z.string().regex(/^[a-f0-9]{64}$/u).optional()
});

const designPreviewSchema = z.object({
  relativePath: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z.number().int().positive(),
  createdAt: z.string().datetime(),
  designRevision: z.number().int().positive()
});

export type DesignPreview = z.infer<typeof designPreviewSchema>;

export interface BookProject {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  projectId: string;
  revision: number;
  sourceRevision: number;
  reworksUsed: number;
  createdAt: string;
  updatedAt: string;
  stage: ProjectStage;
  request: BookRequest;
  selection: SelectionState;
  contentGeneration: { iterationsUsed: number; currentAttempt: 0 | 1 | 2 };
  /** Durable explicit human attestations for corrected, non-default poems. */
  rhymeOverrides: Record<string, HumanApprovedAlternativeRhymeScheme>;
  content?: BookContent;
  illustrations: IllustrationAsset[];
  design?: BookDesign;
  designPreview?: DesignPreview;
  exports: ExportRecord[];
  primaryOutput: PrimaryOutputAcceptance;
  exportFailures: ExportFailure[];
  canva: CanvaState;
}

function now(): string {
  return new Date().toISOString();
}

export function createProject(input: unknown): BookProject {
  const request = bookRequestSchema.parse(input);
  const timestamp = now();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: randomUUID(),
    revision: 1,
    sourceRevision: 1,
    reworksUsed: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    stage: "draft",
    request,
    selection: {
      regenerationsUsed: 0,
      approved: false,
      current: [],
      history: [],
      cumulativeExclusions: []
    },
    contentGeneration: { iterationsUsed: 0, currentAttempt: 0 },
    rhymeOverrides: {},
    illustrations: [],
    design: undefined,
    designPreview: undefined,
    exports: [],
    primaryOutput: { status: "not_ready" },
    exportFailures: [],
    canva: { status: "not_checked" }
  };
}

export function parseProject(input: unknown): BookProject {
  if (!input || typeof input !== "object") throw new Error("Invalid project manifest.");
  const candidate = input as Record<string, unknown>;
  if (candidate.schemaVersion !== PROJECT_SCHEMA_VERSION && candidate.schemaVersion !== "1.1" && candidate.schemaVersion !== "1.0") {
    throw new Error(`Unsupported project schema version: ${String(candidate.schemaVersion)}.`);
  }
  const project = {
    ...(candidate as unknown as BookProject),
    schemaVersion: PROJECT_SCHEMA_VERSION as typeof PROJECT_SCHEMA_VERSION,
    sourceRevision: typeof candidate.sourceRevision === "number" ? candidate.sourceRevision : 1,
    reworksUsed: typeof candidate.reworksUsed === "number" ? candidate.reworksUsed : 0,
    primaryOutput: (candidate.primaryOutput as PrimaryOutputAcceptance | undefined) ?? { status: "not_ready" },
    contentGeneration: (candidate.contentGeneration as BookProject["contentGeneration"] | undefined) ?? { iterationsUsed: 0, currentAttempt: 0 },
    rhymeOverrides: z.record(humanApprovedAlternativeRhymeSchemeSchema).parse(candidate.rhymeOverrides ?? {}),
    request: bookRequestSchema.parse(candidate.request),
    selection: selectionStateSchema.parse(candidate.selection),
    content: candidate.content ? bookContentSchema.parse(candidate.content) : undefined,
    illustrations: z.array(illustrationAssetSchema).parse(candidate.illustrations ?? []),
    design: candidate.design ? bookDesignSchema.parse(candidate.design) : undefined,
    designPreview: candidate.designPreview ? designPreviewSchema.parse(candidate.designPreview) : undefined,
    exportFailures: Array.isArray(candidate.exportFailures) ? candidate.exportFailures as ExportFailure[] : [],
    canva: canvaStateSchema.parse(candidate.canva ?? { status: "not_checked" })
  };
  project.exports = project.exports.map((record) => ({
    ...record,
    sourceRevision: record.sourceRevision ?? project.sourceRevision
  }));
  return project;
}

export async function saveProject(projectDir: string, project: BookProject): Promise<BookProject> {
  requireAbsoluteProjectDir(projectDir);
  await mkdir(projectDir, { recursive: true });
  const updated: BookProject = { ...project, updatedAt: now() };
  const destination = path.join(projectDir, "book-project.json");
  const temporary = path.join(projectDir, `.book-project-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, destination);
  return updated;
}

export async function loadProject(projectDir: string): Promise<BookProject> {
  requireAbsoluteProjectDir(projectDir);
  return parseProject(JSON.parse(await readFile(path.join(projectDir, "book-project.json"), "utf8")));
}

export async function fileDigest(filePath: string): Promise<{ sha256: string; bytes: number }> {
  const data = await readFile(filePath);
  return { sha256: createHash("sha256").update(data).digest("hex"), bytes: data.byteLength };
}

export function safeOutputName(title: string): string {
  const value = title
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLocaleLowerCase("en")
    .slice(0, 80);
  return value || "creature-book";
}

export function resolveInside(baseDir: string, requested: string): string {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, requested);
  const relative = path.relative(base, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Output path must remain inside the project directory.");
  }
  return target;
}
