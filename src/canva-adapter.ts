import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import { canvaHandoffSchema, prepareCanvaHandoff, type CanvaHandoff } from "./canva.ts";
import { resolveApprovedIllustrations, IllustrationValidationError } from "./illustrations.ts";
import { fileDigest, loadProject, resolveInside, safeOutputName } from "./project.ts";

export interface CanvaImportReady {
  outcome: "ready";
  adapterVersion: "1.0";
  connectorOperation: "import_design_from_file";
  ingestionMode: "local_file_artifact";
  designFile: string;
  intendedDesignType: "presentation";
  name: string;
  userIntent: string;
  sourceRevision: number;
  designRevision: number;
  illustrationSetDigest: string;
  pageCount: number;
  artifactSha256: string;
  artifactBytes: number;
  connectorRequest: {
    capability: "import_design_from_url";
    arguments: {
      design_file: string;
      intended_design_type: "presentation";
      name: string;
      user_intent: string;
    };
  };
}

export interface CanvaImportFailure {
  outcome: "failed";
  code: string;
  message: string;
  retryable: boolean;
}

export type CanvaImportResult = CanvaImportReady | CanvaImportFailure;

class CanvaAdapterError extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean) {
    super(message);
    this.name = "CanvaAdapterError";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]!);
}

function metadataJson(handoff: CanvaHandoff): string {
  return JSON.stringify(handoff).replace(/</gu, "\\u003c");
}

function renderCanvaImportHtml(handoff: CanvaHandoff, assetDataUrls: Map<string, string>): string {
  const theme = handoff.theme;
  const pages = handoff.pages.map((page) => {
    const image = page.illustrationAssetId
      ? `<img class="illustration" src="${assetDataUrls.get(page.illustrationAssetId) ?? ""}" alt="${escapeHtml(handoff.illustrations.find((asset) => asset.assetId === page.illustrationAssetId)?.altText ?? "")}" />`
      : "";
    const attributes = `data-document-role="page" data-label="${escapeHtml(page.pageId)}" data-page-id="${escapeHtml(page.pageId)}"`;
    if (page.type === "cover") {
      return `<section class="page cover" ${attributes}>${image}<h1>${escapeHtml(page.title)}</h1>${page.subtitle ? `<p>${escapeHtml(page.subtitle)}</p>` : ""}</section>`;
    }
    if (page.type === "closing") {
      return `<section class="page closing" ${attributes}><h1>${escapeHtml(page.title)}</h1><div class="body">${escapeHtml(page.body)}</div></section>`;
    }
    const sectionLabel = page.type === "funFact" ? "Fun Fact" : page.type === "activity" ? "Activity" : page.poemTitle;
    return `<section class="page section-page" ${attributes}>${image}<div class="copy"><h1>${escapeHtml(page.title)}</h1><h2>${escapeHtml(sectionLabel ?? "")}</h2><div class="body ${page.type === "poem" ? "poem" : ""}">${escapeHtml(page.body)}</div></div></section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="${handoff.language}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(handoff.title)}</title>
<style>
*{box-sizing:border-box}html,body{margin:0;padding:0;background:${theme.colors.background};color:${theme.colors.text};font-family:${JSON.stringify(theme.bodyFont)},sans-serif}.page{width:1280px;height:720px;padding:54px 70px;background:${theme.colors.surface};display:flex;align-items:center;justify-content:center;gap:48px;overflow:hidden;page-break-after:always}.cover{flex-direction:column;background:${theme.colors.primary};color:#FFFFFF}.cover .illustration{width:760px;height:470px}.illustration{display:block;width:590px;height:430px;object-fit:contain;border-radius:${theme.cornerRadius}px}.copy{width:500px;text-align:center}.cover h1{font-size:60px;line-height:1.1;text-align:center;margin:0}.cover p{font-size:28px;margin:0}.section-page h1,.closing h1{font-size:46px;line-height:1.1;color:${theme.colors.primary};margin:0 0 18px}.section-page h2{font-size:31px;color:${theme.colors.secondary};margin:0 0 20px}.body{font-size:27px;line-height:1.4;white-space:pre-wrap}.poem{font-size:30px;line-height:1.5}.closing{flex-direction:column;background:${theme.colors.accent};text-align:center}.closing .body{max-width:900px}
</style>
<script id="faithful-canonical-reproduction" type="application/json">${metadataJson(handoff)}</script>
</head>
<body data-handoff-version="${handoff.handoffVersion}" data-source-revision="${handoff.sourceRevision}" data-design-revision="${handoff.designRevision}" data-illustration-set-digest="${handoff.illustrationSetDigest}">
${pages}
</body>
</html>\n`;
}

async function buildExpectedHandoff(projectDir: string): Promise<{ handoff: CanvaHandoff; assetDataUrls: Map<string, string> }> {
  const project = await loadProject(projectDir);
  if (!project.content || !project.design) throw new CanvaAdapterError("canonical_design_unavailable", "Validated content and an approved canonical BookDesign are required.", false);
  if (project.design.status !== "approved") throw new CanvaAdapterError("design_approval_required", "The current canonical BookDesign is not approved.", false);
  if (project.primaryOutput.status !== "accepted" ||
      project.primaryOutput.sourceRevision !== project.sourceRevision ||
      project.primaryOutput.designRevision !== project.design.designRevision ||
      project.primaryOutput.illustrationSetDigest !== project.design.illustrationSetDigest) {
    throw new CanvaAdapterError("primary_output_acceptance_required", "The current DOCX primary output must be explicitly accepted before Canva ingestion.", false);
  }
  if (project.canva.readiness !== "ready" || !project.canva.checkedAt) {
    throw new CanvaAdapterError("canva_readiness_required", "Current Canva readiness must be recorded before local artifact ingestion.", true);
  }
  if ((project.canva.status !== "consented" && !(project.canva.status === "failed" && project.canva.failure?.retryable)) || !project.canva.consentedAt) {
    throw new CanvaAdapterError("canva_consent_required", "Explicit consent for the current approved design is required before local artifact ingestion.", false);
  }
  const resolved = await resolveApprovedIllustrations(projectDir, project.content, project.illustrations);
  const handoff = prepareCanvaHandoff(project.projectId, project.revision, project.request, project.content, project.illustrations, project.canva, project.design);
  const resolvedById = new Map([
    [resolved.cover.assetId, resolved.cover],
    ...[...resolved.creatures.values()].map((asset) => [asset.assetId, asset] as const)
  ]);
  const assetDataUrls = new Map<string, string>();
  for (const asset of handoff.illustrations) {
    const resolvedAsset = resolvedById.get(asset.assetId);
    if (!resolvedAsset) throw new CanvaAdapterError("asset_integrity_mismatch", `Approved illustration ${asset.assetId} could not be resolved.`, false);
    const data = await readFile(resolvedAsset.absolutePath);
    if (data.byteLength !== asset.bytes || createHash("sha256").update(data).digest("hex") !== asset.sha256) {
      throw new CanvaAdapterError("asset_integrity_mismatch", `Approved illustration ${asset.assetId} changed while the import artifact was being prepared.`, false);
    }
    assetDataUrls.set(asset.assetId, `data:${asset.mimeType};base64,${data.toString("base64")}`);
  }
  return { handoff, assetDataUrls };
}

export async function ingestCanvaHandoff(projectDir: string, input: unknown): Promise<CanvaImportResult> {
  try {
    const supplied = canvaHandoffSchema.parse(input);
    if (supplied.mode !== "faithful_canonical_reproduction") {
      throw new CanvaAdapterError("redesign_rejected", "The local Canva adapter accepts only faithful_canonical_reproduction and will not substitute a template or redesign the approved book.", false);
    }
    const { handoff: expected, assetDataUrls } = await buildExpectedHandoff(projectDir);
    if (JSON.stringify(supplied) !== JSON.stringify(expected)) {
      throw new CanvaAdapterError("canonical_handoff_mismatch", "The supplied handoff does not exactly match the current approved local design, assets, revisions, readiness, and consent evidence.", false);
    }
    const html = renderCanvaImportHtml(supplied, assetDataUrls);
    const outputDir = resolveInside(projectDir, "canva");
    await mkdir(outputDir, { recursive: true });
    const designFile = path.join(outputDir, `${safeOutputName(supplied.title)}-canva-import.html`);
    const temporary = path.join(outputDir, `.canva-import-${randomUUID()}.tmp`);
    await writeFile(temporary, html, { encoding: "utf8", flag: "wx" });
    await rename(temporary, designFile);
    const artifact = await fileDigest(designFile);
    const userIntent = "Import the exact approved local BookDesign into Canva as editable presentation pages without regeneration or substitution.";
    return {
      outcome: "ready",
      adapterVersion: "1.0",
      connectorOperation: "import_design_from_file",
      ingestionMode: "local_file_artifact",
      designFile,
      intendedDesignType: "presentation",
      name: supplied.title,
      userIntent,
      sourceRevision: supplied.sourceRevision,
      designRevision: supplied.designRevision,
      illustrationSetDigest: supplied.illustrationSetDigest,
      pageCount: supplied.slideCount,
      artifactSha256: artifact.sha256,
      artifactBytes: artifact.bytes,
      connectorRequest: {
        capability: "import_design_from_url",
        arguments: {
          design_file: designFile,
          intended_design_type: "presentation",
          name: supplied.title,
          user_intent: userIntent
        }
      }
    };
  } catch (error) {
    if (error instanceof CanvaAdapterError) return { outcome: "failed", code: error.code, message: error.message, retryable: error.retryable };
    if (error instanceof ZodError) return { outcome: "failed", code: "invalid_handoff", message: "The Canva handoff payload is invalid or incomplete.", retryable: false };
    if (error instanceof IllustrationValidationError) return { outcome: "failed", code: "asset_integrity_mismatch", message: error.message, retryable: false };
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
      return { outcome: "failed", code: "local_artifact_unavailable", message: "The approved local Canva source artifact is missing or inaccessible.", retryable: true };
    }
    return { outcome: "failed", code: "adapter_failed", message: "The local Canva import artifact could not be prepared.", retryable: true };
  }
}
