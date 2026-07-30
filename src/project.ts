import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  bookContentSchema,
  bookRequestSchema,
  selectionStateSchema,
  type BookContent,
  type BookRequest,
  type SelectionState
} from "./domain.ts";

export const PROJECT_SCHEMA_VERSION = "1.0";

export type ProjectStage =
  | "draft"
  | "selection_review"
  | "content_review_required"
  | "language_review_required"
  | "documents_ready"
  | "canva_setup_required"
  | "canva_consent_required"
  | "canva_complete"
  | "partially_complete"
  | "failed";

export interface ExportRecord {
  format: "docx" | "pptx" | "pdf";
  relativePath: string;
  sha256: string;
  bytes: number;
  createdAt: string;
}

export interface CanvaState {
  status: "not_checked" | "setup_required" | "ready_for_consent" | "consented" | "complete" | "failed";
  consentedAt?: string;
  designId?: string;
  editUrl?: string;
  error?: string;
}

export interface BookProject {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  projectId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  stage: ProjectStage;
  request: BookRequest;
  selection: SelectionState;
  content?: BookContent;
  exports: ExportRecord[];
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
    exports: [],
    canva: { status: "not_checked" }
  };
}

export function parseProject(input: unknown): BookProject {
  if (!input || typeof input !== "object") throw new Error("Invalid project manifest.");
  const candidate = input as Record<string, unknown>;
  if (candidate.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(`Unsupported project schema version: ${String(candidate.schemaVersion)}.`);
  }
  return {
    ...(candidate as unknown as BookProject),
    request: bookRequestSchema.parse(candidate.request),
    selection: selectionStateSchema.parse(candidate.selection),
    content: candidate.content ? bookContentSchema.parse(candidate.content) : undefined
  };
}

export async function saveProject(projectDir: string, project: BookProject): Promise<string> {
  await mkdir(projectDir, { recursive: true });
  const updated: BookProject = { ...project, updatedAt: now() };
  const destination = path.join(projectDir, "book-project.json");
  const temporary = path.join(projectDir, `.book-project-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, destination);
  return destination;
}

export async function loadProject(projectDir: string): Promise<BookProject> {
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
