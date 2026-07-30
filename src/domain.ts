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

export const creatureContentSchema = z.object({
  creatureId: z.string().min(1),
  displayName: z.string().min(1),
  poem: contentSectionSchema,
  funFact: contentSectionSchema,
  activity: contentSectionSchema,
  illustrationBrief: z.string().min(1),
  altText: z.string().min(1)
});

export const bookContentSchema = z.object({
  schemaVersion: z.literal("1.0"),
  title: z.string().min(1),
  language: languageSchema,
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
