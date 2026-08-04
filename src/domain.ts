import { z } from "zod";

export const LIMITS = {
  defaultCreatures: 5,
  maxCreatures: 20,
  maxPages: 100,
  batchThreshold: 10,
  batchSize: 5,
  maxRegenerations: 2,
  canvaVolumeWarningSlides: 50,
  maxTitleCharacters: 120,
  maxBriefCharacters: 20_000,
  maxCreatureNameCharacters: 100,
  maxDisplayNameCharacters: 80,
  maxIllustrationBriefCharacters: 400,
  maxAltTextCharacters: 300,
  maxClosingNoteCharacters: 240,
  maxSectionWords: 250,
  maxTotalWords: 25_000,
  maxIllustrationBytes: 15 * 1024 * 1024,
  maxIllustrationSetBytes: 80 * 1024 * 1024,
  maxIllustrationDimension: 20_000,
  minIllustrationLongEdge: 600,
  minIllustrationShortEdge: 350
} as const;

export const PPTX_AGE_PROFILES = {
  "3-5": { creatureTitleFontSize: 30, sectionTitleFontSize: 24, bodyFontSize: 28, maxExplicitLines: 8, sections: { poem: { words: 40, characters: 260 }, funFact: { words: 25, characters: 180 }, activity: { words: 30, characters: 220 } } },
  "6-8": { creatureTitleFontSize: 28, sectionTitleFontSize: 24, bodyFontSize: 24, maxExplicitLines: 10, sections: { poem: { words: 60, characters: 400 }, funFact: { words: 40, characters: 280 }, activity: { words: 50, characters: 340 } } },
  "9-11": { creatureTitleFontSize: 26, sectionTitleFontSize: 24, bodyFontSize: 21, maxExplicitLines: 12, sections: { poem: { words: 90, characters: 600 }, funFact: { words: 60, characters: 420 }, activity: { words: 75, characters: 520 } } },
  "12-14": { creatureTitleFontSize: 24, sectionTitleFontSize: 24, bodyFontSize: 18, maxExplicitLines: 14, sections: { poem: { words: 120, characters: 800 }, funFact: { words: 80, characters: 560 }, activity: { words: 100, characters: 700 } } }
} as const satisfies Record<AgeBand, object>;

export const languageSchema = z.enum(["en", "kn"]);
export const ageBandSchema = z.enum(["3-5", "6-8", "9-11", "12-14"]);
export type AgeBand = z.infer<typeof ageBandSchema>;
export const rhymeSchemeSchema = z.enum(["AA", "AAB", "AABB"]);

export const POEM_STRUCTURE_BY_AGE = {
  "3-5": { stanzaCount: 2, linesPerStanza: 2, rhymeScheme: "AA", minWords: 8, maxWords: 40 },
  "6-8": { stanzaCount: 2, linesPerStanza: 3, rhymeScheme: "AAB", minWords: 16, maxWords: 70 },
  "9-11": { stanzaCount: 3, linesPerStanza: 4, rhymeScheme: "AABB", minWords: 30, maxWords: 130 },
  "12-14": { stanzaCount: 4, linesPerStanza: 3, rhymeScheme: "AAB", minWords: 48, maxWords: 200 }
} as const satisfies Record<AgeBand, object>;

export const DOCX_TYPOGRAPHY_BY_AGE = {
  "3-5": { bodyPoints: 20, poemPoints: 22, lineSpacing: 1.3, maxSectionWords: 70 },
  "6-8": { bodyPoints: 18, poemPoints: 20, lineSpacing: 1.25, maxSectionWords: 100 },
  "9-11": { bodyPoints: 16, poemPoints: 18, lineSpacing: 1.2, maxSectionWords: 140 },
  "12-14": { bodyPoints: 14, poemPoints: 16, lineSpacing: 1.15, maxSectionWords: 180 }
} as const satisfies Record<AgeBand, object>;

export const DOCX_LIMITS = {
  maxIllustrationBriefWords: 60,
  maxAltTextWords: 40,
  maxClosingNoteWords: 120
} as const;

export const nextAgeBand = (ageBand: AgeBand): AgeBand => ({
  "3-5": "6-8", "6-8": "9-11", "9-11": "12-14", "12-14": "12-14"
})[ageBand] as AgeBand;
export const creatureStatusSchema = z.enum(["living", "extinct", "mythical"]);

export const creatureSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(LIMITS.maxCreatureNameCharacters),
  kannadaName: z.string().max(LIMITS.maxCreatureNameCharacters).optional(),
  aliases: z.array(z.string().min(1).max(100)).default([]),
  scientificName: z.string().max(150).optional(),
  status: creatureStatusSchema.default("living"),
  groups: z.array(z.string().min(1).max(80)).default([]),
  habitats: z.array(z.string().min(1).max(80)).default([]),
  pinned: z.boolean().default(false)
});

export const bookRequestSchema = z.object({
  title: z.string().min(1).max(LIMITS.maxTitleCharacters),
  theme: z.string().min(1).max(200),
  ageBand: ageBandSchema.default("6-8"),
  language: languageSchema.default("en"),
  creatureCount: z.number().int().min(1).max(LIMITS.maxCreatures).default(LIMITS.defaultCreatures),
  brief: z.string().max(LIMITS.maxBriefCharacters).default(""),
  allowMythical: z.boolean().default(false),
  outputFormats: z.array(z.enum(["docx", "pptx", "pdf"])).default(["docx"])
}).transform((value) => ({
  ...value,
  outputFormats: Array.from(new Set(["docx" as const, ...value.outputFormats]))
}));

// Interactive creation requires a deliberate age and language choice. The
// persisted schema above retains defaults for backwards-compatible loading.
export const interactiveBookRequestSchema = z.object({
  title: z.string().min(1).max(LIMITS.maxTitleCharacters),
  theme: z.string().min(1).max(200),
  ageBand: ageBandSchema.describe("Ask the user to choose one supported age band."),
  language: languageSchema.describe("Ask the user to choose English or experimental Kannada. Kannada requires fluent human review and discretion."),
  creatureCount: z.number().int().min(1).max(LIMITS.maxCreatures).default(LIMITS.defaultCreatures),
  brief: z.string().max(LIMITS.maxBriefCharacters).default(""),
  allowMythical: z.boolean().default(false),
  outputFormats: z.array(z.enum(["docx", "pptx", "pdf"])).default(["docx"])
}).transform((value) => ({
  ...value,
  outputFormats: Array.from(new Set(["docx" as const, ...value.outputFormats]))
}));

export const contentSectionSchema = z.object({
  text: z.string().min(1),
  language: languageSchema,
  reviewStatus: z.enum(["needs_review", "human_reviewed", "source_supported"]).default("needs_review")
});

export const poemSectionSchema = contentSectionSchema.extend({
  title: z.string().trim().min(1).max(80),
  structureVersion: z.literal("1.0"),
  rhymeScheme: rhymeSchemeSchema
});

export const creatureContentSchema = z.object({
  creatureId: z.string().min(1),
  displayName: z.string().min(1).max(LIMITS.maxDisplayNameCharacters),
  poem: poemSectionSchema,
  funFact: contentSectionSchema,
  activity: contentSectionSchema,
  illustrationBrief: z.string().min(1).max(LIMITS.maxIllustrationBriefCharacters),
  altText: z.string().min(1).max(LIMITS.maxAltTextCharacters)
});

export const illustrationMimeTypeSchema = z.enum(["image/png", "image/jpeg"]);
export const illustrationRoleSchema = z.enum(["cover", "creature"]);
export const illustrationAssetSchema = z.object({
  assetId: z.string().min(1).max(160),
  role: illustrationRoleSchema,
  creatureId: z.string().min(1).max(120).optional(),
  approvalStatus: z.enum(["pending_review", "approved", "rejected"]),
  relativePath: z.string().min(1),
  mimeType: illustrationMimeTypeSchema,
  width: z.number().int().positive().max(LIMITS.maxIllustrationDimension),
  height: z.number().int().positive().max(LIMITS.maxIllustrationDimension),
  bytes: z.number().int().positive().max(LIMITS.maxIllustrationBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  altText: z.string().trim().min(1).max(LIMITS.maxAltTextCharacters),
  source: z.enum(["host_generated", "user_supplied", "code_native"]),
  provenance: z.object({
    importedAt: z.string().datetime(),
    createdBy: z.string().trim().min(1).max(200).optional(),
    generator: z.string().trim().min(1).max(200).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    sourceUri: z.string().url().optional(),
    promptDigest: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    notes: z.string().trim().min(1).max(1_000).optional()
  }),
  license: z.object({
    name: z.string().trim().min(1).max(200),
    url: z.string().url().optional(),
    attribution: z.string().trim().min(1).max(500).optional(),
    usageNotes: z.string().trim().min(1).max(1_000).optional()
  }),
  approvedAt: z.string().datetime().optional(),
  approvedBy: z.string().trim().min(1).max(200).optional(),
  approvalNote: z.string().trim().min(1).max(1_000).optional()
}).superRefine((asset, context) => {
  if (asset.role === "cover" && asset.creatureId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["creatureId"], message: "Cover artwork must not identify a creature slot." });
  }
  if (asset.role === "creature" && !asset.creatureId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["creatureId"], message: "Creature artwork must identify its creature slot." });
  }
  if (asset.role === "cover" && asset.assetId !== "cover") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["assetId"], message: "Cover artwork must use the cover asset slot." });
  }
  if (asset.role === "creature" && asset.creatureId && asset.assetId !== `creature-${asset.creatureId}`) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["assetId"], message: "Creature artwork assetId must match its creature slot." });
  }
  if (asset.approvalStatus === "approved" && (!asset.approvedAt || !asset.approvedBy)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["approvalStatus"], message: "Approved artwork requires approval time and reviewer." });
  }
});

export const bookContentSchema = z.object({
  schemaVersion: z.literal("1.1"),
  title: z.string().min(1),
  language: languageSchema,
  selectedAgeBand: ageBandSchema,
  effectiveAgeBand: ageBandSchema,
  generationAttempt: z.number().int().min(0).max(2),
  creatures: z.array(creatureContentSchema).min(1).max(LIMITS.maxCreatures),
  closingNote: z.string().max(LIMITS.maxClosingNoteCharacters).optional()
});

export const selectionAttemptSchema = z.object({
  attempt: z.number().int().min(0).max(LIMITS.maxRegenerations),
  createdAt: z.string().datetime(),
  creatureIds: z.array(z.string()),
  excludedPrevious: z.boolean()
});

export const selectionStateSchema = z.object({
  regenerationsUsed: z.number().int().min(0).max(LIMITS.maxRegenerations).default(0),
  approved: z.boolean().default(false),
  current: z.array(creatureSchema).max(LIMITS.maxCreatures).default([]),
  history: z.array(selectionAttemptSchema).default([]),
  cumulativeExclusions: z.array(z.string()).default([])
});

export type BookRequest = z.infer<typeof bookRequestSchema>;
export type Creature = z.infer<typeof creatureSchema>;
export type BookContent = z.infer<typeof bookContentSchema>;
export type SelectionState = z.infer<typeof selectionStateSchema>;
export type IllustrationAsset = z.infer<typeof illustrationAssetSchema>;

export function projectedPageCount(content: Pick<BookContent, "creatures" | "closingNote">): number {
  return 1 + content.creatures.length * 3 + (content.closingNote?.trim() ? 1 : 0);
}

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
  creaturesCovered: string[];
  missingCreatureIds: string[];
  unexpectedCreatureIds: string[];
  pageCount: number;
  wordCount: number;
}
