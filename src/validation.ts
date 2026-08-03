import {
  LIMITS,
  PPTX_AGE_PROFILES,
  bookContentSchema,
  type BookContent,
  type BookRequest,
  type Creature,
  type ValidationIssue,
  type ValidationReport
} from "./domain.ts";

function words(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function characters(value: string): number {
  return Array.from(value).length;
}

function explicitLines(value: string): number {
  return value.split(/\r?\n/u).length;
}

export function validateBookContent(
  input: unknown,
  approvedCreatures: Creature[],
  context: Pick<BookRequest, "ageBand" | "language"> = { ageBand: "6-8", language: "en" }
): { content?: BookContent; report: ValidationReport } {
  const issues: ValidationIssue[] = [];
  const parsed = bookContentSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        level: "error",
        code: "schema",
        path: issue.path.join("."),
        message: issue.message
      });
    }
    return {
      report: {
        valid: false,
        issues,
        creaturesCovered: [],
        missingCreatureIds: approvedCreatures.map((creature) => creature.id),
        unexpectedCreatureIds: [],
        pageCount: 0,
        wordCount: 0
      }
    };
  }

  const content = parsed.data;
  const profile = PPTX_AGE_PROFILES[context.ageBand];
  if (content.language !== context.language) {
    issues.push({ level: "error", code: "book_language_mismatch", path: "language", message: `Content language ${content.language} does not match requested language ${context.language}.` });
  }
  const expected = new Set(approvedCreatures.map((creature) => creature.id));
  const actual = new Set(content.creatures.map((creature) => creature.creatureId));
  const duplicateIds = content.creatures
    .map((creature) => creature.creatureId)
    .filter((id, index, all) => all.indexOf(id) !== index);
  const missingCreatureIds = [...expected].filter((id) => !actual.has(id));
  const unexpectedCreatureIds = [...actual].filter((id) => !expected.has(id));

  for (const id of new Set(duplicateIds)) {
    issues.push({ level: "error", code: "duplicate_creature", path: "creatures", message: `Creature ${id} appears more than once.` });
  }
  for (const id of missingCreatureIds) {
    issues.push({ level: "error", code: "missing_creature", path: "creatures", message: `Approved creature ${id} is missing.` });
  }
  for (const id of unexpectedCreatureIds) {
    issues.push({ level: "error", code: "unexpected_creature", path: "creatures", message: `Unapproved creature ${id} was introduced.` });
  }

  let wordCount = 0;
  for (const [index, creature] of content.creatures.entries()) {
    for (const sectionName of ["poem", "funFact", "activity"] as const) {
      const count = words(creature[sectionName].text);
      const characterCount = characters(creature[sectionName].text);
      const lineCount = explicitLines(creature[sectionName].text);
      const limit = profile.sections[sectionName];
      const characterLimit = content.language === "kn" ? Math.floor(limit.characters * 0.85) : limit.characters;
      wordCount += count;
      if (creature[sectionName].language !== content.language) {
        issues.push({ level: "error", code: "section_language_mismatch", path: `creatures.${index}.${sectionName}.language`, message: `${sectionName} language does not match the book language.` });
      }
      if (count > limit.words) {
        issues.push({
          level: "error",
          code: "section_word_overflow",
          path: `creatures.${index}.${sectionName}.text`,
          message: `${sectionName} exceeds the ${context.ageBand} limit of ${limit.words} words.`
        });
      }
      if (characterCount > characterLimit) {
        issues.push({ level: "error", code: "section_character_overflow", path: `creatures.${index}.${sectionName}.text`, message: `${sectionName} exceeds the ${context.ageBand}${content.language === "kn" ? " Kannada" : ""} limit of ${characterLimit} characters.` });
      }
      if (lineCount > profile.maxExplicitLines) {
        issues.push({ level: "error", code: "section_line_overflow", path: `creatures.${index}.${sectionName}.text`, message: `${sectionName} exceeds the ${context.ageBand} limit of ${profile.maxExplicitLines} explicit lines.` });
      }
    }
    if (creature.funFact.reviewStatus === "needs_review") {
      issues.push({
        level: "warning",
        code: "fact_review_required",
        path: `creatures.${index}.funFact`,
        message: `${creature.displayName}'s fun fact requires review.`
      });
    }
    if (content.language === "kn") {
      const hasKannada = /[\u0C80-\u0CFF]/u.test(
        `${creature.poem.text}${creature.funFact.text}${creature.activity.text}`
      );
      if (!hasKannada) {
        issues.push({
          level: "error",
          code: "kannada_script_missing",
          path: `creatures.${index}`,
          message: `${creature.displayName} does not contain Kannada-script content.`
        });
      }
    }
  }

  const pageCount = 1 + content.creatures.length * 3;
  if (pageCount > LIMITS.maxPages) {
    issues.push({ level: "error", code: "page_limit", path: "creatures", message: `Projected page count ${pageCount} exceeds ${LIMITS.maxPages}.` });
  }
  if (wordCount > LIMITS.maxTotalWords) {
    issues.push({ level: "error", code: "word_limit", path: "creatures", message: `Total word count ${wordCount} exceeds ${LIMITS.maxTotalWords}.` });
  }
  if (content.language === "kn") {
    issues.push({ level: "warning", code: "kannada_pptx_font_required", path: "language", message: "Kannada PPTX output references Noto Sans Kannada but does not embed it; install the font on viewing and editing systems." });
  }

  return {
    content,
    report: {
      valid: !issues.some((issue) => issue.level === "error"),
      issues,
      creaturesCovered: content.creatures.map((creature) => creature.displayName),
      missingCreatureIds,
      unexpectedCreatureIds,
      pageCount,
      wordCount
    }
  };
}
