import {
  LIMITS,
  bookContentSchema,
  type BookContent,
  type Creature,
  type ValidationIssue,
  type ValidationReport
} from "./domain.ts";

function words(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

export function validateBookContent(
  input: unknown,
  approvedCreatures: Creature[]
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
      wordCount += count;
      if (count > LIMITS.maxSectionWords) {
        issues.push({
          level: "error",
          code: "section_too_long",
          path: `creatures.${index}.${sectionName}.text`,
          message: `${sectionName} exceeds ${LIMITS.maxSectionWords} words.`
        });
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
