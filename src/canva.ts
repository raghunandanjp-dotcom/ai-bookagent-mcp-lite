import { z } from "zod";
import { LIMITS, type BookContent, type BookRequest, type IllustrationAsset } from "./domain.ts";
import type { BookDesign } from "./design.ts";
import type { CanvaState } from "./project.ts";

export const canvaCapabilitySchema = z.object({
  status: z.enum(["ready", "unavailable", "authorization_required"]),
  connectorName: z.string().optional(),
  toolName: z.string().optional()
});

const designIdSchema = z.string().trim().min(1).regex(/^[A-Za-z0-9_-]+$/, "The Canva design ID contains unsupported characters.");

function isMatchingCanvaEditUrl(value: string, designId: string): boolean {
  const url = new URL(value);
  const hostname = url.hostname.toLocaleLowerCase("en");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  if (hostname !== "canva.com" && !hostname.endsWith(".canva.com")) return false;
  const match = url.pathname.match(/^\/design\/([^/]+)(?:\/edit)?\/?$/u);
  if (!match) return false;
  try { return decodeURIComponent(match[1]) === designId; } catch { return false; }
}

export const canvaResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("success"),
    designId: designIdSchema,
    editUrl: z.string().url(),
    sourceRevision: z.number().int().positive(),
    designRevision: z.number().int().positive(),
    illustrationSetDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    pageCount: z.number().int().positive()
  }),
  z.object({
    outcome: z.literal("failed"),
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    retryable: z.boolean()
  })
]).superRefine((result, context) => {
  if (result.outcome === "success" && !isMatchingCanvaEditUrl(result.editUrl, result.designId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["editUrl"], message: "The edit URL must be an HTTPS Canva design URL whose path matches designId." });
  }
});

export function checkCanvaReadiness(capability: unknown): CanvaState {
  const parsed = canvaCapabilitySchema.parse(capability);
  const checkedAt = new Date().toISOString();
  const adapter = parsed.connectorName || parsed.toolName ? { connectorName: parsed.connectorName, toolName: parsed.toolName } : undefined;
  if (parsed.status !== "ready") {
    return {
      status: "setup_required",
      readiness: parsed.status,
      checkedAt,
      adapter,
      setupInstructions: parsed.status === "authorization_required" ? [
        "Open the host's connector or integration settings.",
        "Authorize the intended Canva account, then run the readiness check again."
      ] : [
        "Open the host's connector or integration settings.",
        "Install or enable Canva, then authorize the intended Canva account.",
        "Return to this project and run the Canva readiness check again."
      ]
    };
  }
  return { status: "ready_for_consent", readiness: "ready", checkedAt, adapter };
}

export function recordCanvaConsent(consent: boolean): CanvaState {
  if (!consent) return { status: "declined", declinedAt: new Date().toISOString() };
  return { status: "consented", consentedAt: new Date().toISOString() };
}

export function prepareCanvaHandoff(
  projectId: string,
  revision: number,
  request: BookRequest,
  content: BookContent,
  illustrations: IllustrationAsset[],
  canva: CanvaState,
  design: BookDesign
) {
  if (canva.status !== "consented" && !(canva.status === "failed" && canva.failure?.retryable && canva.consentedAt)) {
    throw new Error("Explicit Canva consent is required before preparing the handoff.");
  }
  if (design.status !== "approved" || design.sourceRevision !== canva.sourceRevision || design.designRevision !== canva.designRevision || design.illustrationSetDigest !== canva.illustrationSetDigest) {
    throw new Error("The approved canonical BookDesign does not match the consented Canva handoff.");
  }
  const requiredAssetIds = ["cover", ...content.creatures.map((creature) => `creature-${creature.creatureId}`)];
  if (illustrations.length !== requiredAssetIds.length || requiredAssetIds.some((id) => illustrations.filter((asset) => asset.assetId === id && asset.approvalStatus === "approved").length !== 1)) {
    throw new Error("Every required cover and creature illustration must be uniquely approved before preparing the Canva handoff.");
  }
  const slideCount = design.pages.length;
  return {
    handoffVersion: "2.0",
    operation: "create_editable_design",
    mode: canva.selection ? "explicit_redesign_requested" : "faithful_canonical_reproduction",
    correlation: { projectId, revision },
    sourceRevision: design.sourceRevision,
    designRevision: design.designRevision,
    illustrationSetDigest: design.illustrationSetDigest,
    ...(canva.selection ? { selectedDesign: canva.selection } : {}),
    designType: "presentation",
    title: content.title,
    dimensions: "16:9",
    slideCount,
    recommendMultipleVolumes: slideCount > LIMITS.canvaVolumeWarningSlides,
    language: request.language,
    audience: `ages ${request.ageBand}`,
    creaturesCovered: content.creatures.map((creature) => creature.displayName),
    locale: request.language === "kn" ? "kn-IN" : "en-US",
    theme: design.theme,
    formatProfile: design.formatProfiles.presentation,
    formatExceptions: design.formatExceptions.filter((item) => item.format === "canva"),
    typography: request.language === "kn" ? {
      script: "Kannada", preferredFont: "Noto Sans Kannada", requireKannadaGlyphCoverage: true, preserveEditableText: true,
      fallbackPolicy: "Do not transliterate, replace, or rasterize Kannada text. If a Kannada-capable editable font is unavailable, return a structured non-retryable failure."
    } : { script: "Latin", preferredFont: "Noto Sans", preserveEditableText: true },
    review: request.language === "kn" ? { experimental: true, humanLanguageReviewRequired: true, renderedGlyphReviewRequired: true } : { experimental: false, humanLanguageReviewRequired: false, renderedGlyphReviewRequired: false },
    instruction: request.language === "kn"
      ? "Faithfully reproduce the approved canonical BookDesign as an editable Canva presentation. Preserve page order, every Kannada character, line and stanza breaks, wording, colors, typography intent, and illustration placement. Never transliterate or rasterize text. Report any required font substitution or other format exception; return a structured failure if glyph coverage cannot be preserved."
      : "Faithfully reproduce the approved canonical BookDesign as an editable Canva presentation. Preserve page order, wording, line and stanza breaks, colors, typography intent, illustration placement, and editable text. Report every unavoidable format exception instead of silently redesigning.",
    illustrations: requiredAssetIds.map((id) => illustrations.find((asset) => asset.assetId === id)!).map((asset) => ({
      assetId: asset.assetId, role: asset.role, creatureId: asset.creatureId, relativePath: asset.relativePath, mimeType: asset.mimeType,
      width: asset.width, height: asset.height, bytes: asset.bytes, sha256: asset.sha256, altText: asset.altText,
      source: asset.source, provenance: asset.provenance, license: asset.license
    })),
    pages: design.pages
  };
}

export function recordCanvaResult(input: unknown, expected?: Pick<BookDesign, "sourceRevision" | "designRevision" | "illustrationSetDigest" | "pages">): CanvaState {
  const result = canvaResultSchema.parse(input);
  if (result.outcome === "failed") {
    return { status: "failed", failure: { code: result.code, message: result.message, retryable: result.retryable, failedAt: new Date().toISOString() } };
  }
  if (expected && (result.sourceRevision !== expected.sourceRevision || result.designRevision !== expected.designRevision || result.illustrationSetDigest !== expected.illustrationSetDigest || result.pageCount !== expected.pages.length)) {
    throw new Error("Canva result parity metadata does not match the approved canonical BookDesign.");
  }
  return { status: "complete", designId: result.designId, editUrl: result.editUrl };
}
