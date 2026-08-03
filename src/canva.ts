import { z } from "zod";
import { LIMITS, type BookContent, type BookRequest } from "./domain.ts";
import type { CanvaState } from "./project.ts";

export const canvaCapabilitySchema = z.object({
  available: z.boolean(),
  connectorName: z.string().optional(),
  toolName: z.string().optional()
});

export const canvaResultSchema = z.object({
  designId: z.string().min(1),
  editUrl: z.string().url().refine((value) => {
    const hostname = new URL(value).hostname.toLocaleLowerCase("en");
    return hostname === "canva.com" || hostname.endsWith(".canva.com");
  }, "The edit URL must use the canva.com domain.")
});

export function checkCanvaReadiness(capability: unknown): CanvaState & { setupInstructions?: string[] } {
  const parsed = canvaCapabilitySchema.parse(capability);
  if (!parsed.available) {
    return {
      status: "setup_required",
      setupInstructions: [
        "Open Claude's connector or integration settings.",
        "Install or enable Canva and authorize the intended Canva account.",
        "Return to this project and run the Canva readiness check again."
      ]
    };
  }
  return { status: "design_selection_required" };
}

export function recordCanvaConsent(consent: boolean): CanvaState {
  if (!consent) return { status: "ready_for_consent" };
  return { status: "consented", consentedAt: new Date().toISOString() };
}

export function prepareCanvaHandoff(request: BookRequest, content: BookContent, canva: CanvaState) {
  if (canva.status !== "consented") throw new Error("Explicit Canva consent is required before preparing the handoff.");
  if (!canva.selection || canva.selection.sourceRevision !== canva.sourceRevision) {
    throw new Error("A Canva design must be selected for the current source revision.");
  }
  const slideCount = 1 + content.creatures.length * 3;
  return {
    handoffVersion: "1.0",
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
    instruction: "Create an editable children's presentation. Preserve all supplied text, use large readable type, strong contrast, consistent creature illustration treatment, and one poem, fun fact, and activity slide per creature.",
    pages: [
      { type: "cover", title: content.title },
      ...content.creatures.flatMap((creature) =>
        (["poem", "funFact", "activity"] as const).map((section) => ({
          type: section,
          creatureId: creature.creatureId,
          creature: creature.displayName,
          title: `${creature.displayName} - ${section === "funFact" ? "Fun Fact" : section[0].toUpperCase() + section.slice(1)}`,
          body: creature[section].text,
          illustrationBrief: creature.illustrationBrief,
          altText: creature.altText
        }))
      )
    ]
  };
}

export function recordCanvaResult(input: unknown): CanvaState {
  const result = canvaResultSchema.parse(input);
  return { status: "complete", designId: result.designId, editUrl: result.editUrl };
}
