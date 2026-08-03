import { z } from "zod";
import { LIMITS, type BookContent, type BookRequest } from "./domain.ts";
import type { CanvaState } from "./project.ts";
import { normalizePoemText } from "./poems.ts";

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
  try {
    return decodeURIComponent(match[1]) === designId;
  } catch {
    return false;
  }
}

export const canvaResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("success"),
    designId: designIdSchema,
    editUrl: z.string().url()
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
  const adapter = parsed.connectorName || parsed.toolName
    ? { connectorName: parsed.connectorName, toolName: parsed.toolName }
    : undefined;
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
        "Open Claude's connector or integration settings.",
        "Install or enable Canva, then authorize the intended Canva account.",
        "Return to this project and run the Canva readiness check again."
      ]
    };
  }
  return { status: "design_selection_required", readiness: "ready", checkedAt, adapter };
}

export function recordCanvaConsent(consent: boolean): CanvaState {
  if (!consent) return { status: "declined", declinedAt: new Date().toISOString() };
  return { status: "consented", consentedAt: new Date().toISOString() };
}

function canvaSectionTitle(language: BookRequest["language"], section: "poem" | "funFact" | "activity"): string {
  if (language === "kn") {
    return section === "poem" ? "ಕವಿತೆ" : section === "funFact" ? "ಆಸಕ್ತಿದಾಯಕ ಸಂಗತಿ" : "ಚಟುವಟಿಕೆ";
  }
  return section === "poem" ? "Poem" : section === "funFact" ? "Fun Fact" : "Activity";
}

export function prepareCanvaHandoff(projectId: string, revision: number, request: BookRequest, content: BookContent, canva: CanvaState) {
  if (canva.status !== "consented" && !(canva.status === "failed" && canva.failure?.retryable && canva.consentedAt)) {
    throw new Error("Explicit Canva consent is required before preparing the handoff.");
  }
  if (!canva.selection || canva.selection.sourceRevision !== canva.sourceRevision) {
    throw new Error("A Canva design must be selected for the current source revision.");
  }
  const slideCount = 1 + content.creatures.length * 3;
  return {
    handoffVersion: "1.0",
    operation: "create_editable_design",
    correlation: { projectId, revision },
    sourceRevision: canva.sourceRevision,
    selectedDesign: canva.selection,
    designType: "presentation",
    title: content.title,
    dimensions: "16:9",
    slideCount,
    recommendMultipleVolumes: slideCount > LIMITS.canvaVolumeWarningSlides,
    language: request.language,
    audience: `ages ${request.ageBand}`,
    creaturesCovered: content.creatures.map((creature) => creature.displayName),
    locale: request.language === "kn" ? "kn-IN" : "en-US",
    typography: request.language === "kn" ? {
      script: "Kannada",
      preferredFont: "Noto Sans Kannada",
      requireKannadaGlyphCoverage: true,
      preserveEditableText: true,
      fallbackPolicy: "Do not transliterate, replace, or rasterize Kannada text. If a Kannada-capable editable font is unavailable, return a structured non-retryable failure."
    } : {
      script: "Latin",
      preferredFont: "Noto Sans",
      preserveEditableText: true
    },
    review: request.language === "kn" ? {
      experimental: true,
      humanLanguageReviewRequired: true,
      renderedGlyphReviewRequired: true
    } : {
      experimental: false,
      humanLanguageReviewRequired: false,
      renderedGlyphReviewRequired: false
    },
    instruction: request.language === "kn"
      ? "Create an editable children's presentation in Kannada. Preserve every supplied Kannada character and intentional poem line/stanza break. Use a Kannada-capable editable font, preferably Noto Sans Kannada; never transliterate, replace, or rasterize the text. Use large readable type, strong contrast, consistent creature illustration treatment, and one poem, fun fact, and activity slide per creature. Return a structured failure if Kannada glyph coverage cannot be preserved."
      : "Create an editable children's presentation. Preserve all supplied text and intentional poem line/stanza breaks, use large readable type, strong contrast, consistent creature illustration treatment, and one poem, fun fact, and activity slide per creature.",
    pages: [
      { type: "cover", title: content.title },
      ...content.creatures.flatMap((creature) =>
        (["poem", "funFact", "activity"] as const).map((section) => ({
          type: section,
          creatureId: creature.creatureId,
          creature: creature.displayName,
          title: `${creature.displayName} — ${canvaSectionTitle(request.language, section)}`,
          body: section === "poem" ? normalizePoemText(creature.poem.text) : creature[section].text,
          ...(section === "poem" ? { poemTitle: creature.poem.title, rhymeScheme: creature.poem.rhymeScheme } : {}),
          illustrationBrief: creature.illustrationBrief,
          altText: creature.altText
        }))
      )
    ]
  };
}

export function recordCanvaResult(input: unknown): CanvaState {
  const result = canvaResultSchema.parse(input);
  if (result.outcome === "failed") {
    return {
      status: "failed",
      failure: { code: result.code, message: result.message, retryable: result.retryable, failedAt: new Date().toISOString() }
    };
  }
  return { status: "complete", designId: result.designId, editUrl: result.editUrl };
}
