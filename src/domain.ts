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
  maxSectionWords: 250,
  maxDisplayNameCharacters: 80,
  maxIllustrationBriefCharacters: 400,
  maxAltTextCharacters: 300,
  maxClosingNoteCharacters: 240,
  maxTotalWords: 25_000
} as const;

export const PPTX_AGE_PROFILES = {
  "3-5": {
    creatureTitleFontSize: 30, sectionTitleFontSize: 24, bodyFontSize: 28,
    maxExplicitLines: 8,
    sections: { poem: { words: 40, characters: 260 }, funFact: { words: 25, characters: 180 }, activity: { words: 30, characters: 220 } }
  },
  "6-8": {
    creatureTitleFontSize: 28, sectionTitleFontSize: 24, bodyFontSize: 24,
    maxExplicitLines: 10,
    sections: { poem: { words: 60, characters: 400 }, funFact: { words: 40, characters: 280 }, activity: { words: 50, characters: 340 } }
  },
  "9-11": {
    creatureTitleFontSize: 26, sectionTitleFontSize: 24, bodyFontSize: 21,
    maxExplicitLines: 12,
    sections: { poem: { words: 90, characters: 600 }, funFact: { words: 60, characters: 420 }, activity: { words: 75, characters: 520 } }
  },
  "12-14": {
    creatureTitleFontSize: 24, sectionTitleFontSize: 24, bodyFontSize: 18,
    maxExplicitLines: 14,
    sections: { poem: { words: 120, characters: 800 }, funFact: { words: 80, characters: 560 }, activity: { words: 100, characters: 700 } }
  }
} as const;

export const languageSchema = z.enum(["en", "kn"]);
export const ageBandSchema = z.enum(["3-5", "6-8", "9-11", "12-14"]);
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

export const contentSectionSchema = z.object({
  text: z.string().min(1),
  language: languageSchema,
  reviewStatus: z.enum(["needs_review", "human_reviewed", "source_supported"]).default("needs_review")
}).strict();

export const creatureContentSchema = z.object({
  creatureId: z.string().min(1),
  displayName: z.string().min(1).max(LIMITS.maxDisplayNameCharacters),
  poem: contentSectionSchema,
  funFact: contentSectionSchema,
  activity: contentSectionSchema,
  illustrationBrief: z.string().min(1).max(LIMITS.maxIllustrationBriefCharacters),
  altText: z.string().min(1).max(LIMITS.maxAltTextCharacters)
}).strict();

export const bookContentSchema = z.object({
  schemaVersion: z.literal("1.0"),
  title: z.string().min(1),
  language: languageSchema,
  creatures: z.array(creatureContentSchema).min(1).max(LIMITS.maxCreatures),
  closingNote: z.string().max(LIMITS.maxClosingNoteCharacters).optional()
}).strict();

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
