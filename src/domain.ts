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
  maxTotalWords: 25_000
} as const;

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
  displayName: z.string().min(1),
  poem: poemSectionSchema,
  funFact: contentSectionSchema,
  activity: contentSectionSchema,
  illustrationBrief: z.string().min(1),
  altText: z.string().min(1)
});

export const bookContentSchema = z.object({
  schemaVersion: z.literal("1.1"),
  title: z.string().min(1),
  language: languageSchema,
  selectedAgeBand: ageBandSchema,
  effectiveAgeBand: ageBandSchema,
  generationAttempt: z.number().int().min(0).max(2),
  creatures: z.array(creatureContentSchema).min(1).max(LIMITS.maxCreatures),
  closingNote: z.string().optional()
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
