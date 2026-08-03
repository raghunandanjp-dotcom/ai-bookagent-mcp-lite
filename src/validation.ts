import {
  LIMITS,
  DOCX_LIMITS,
  DOCX_TYPOGRAPHY_BY_AGE,
  PPTX_AGE_PROFILES,
  bookContentSchema,
  projectedPageCount,
  type BookContent,
  type BookRequest,
  type Creature,
  type ValidationIssue,
  type ValidationReport
} from "./domain.ts";
import { analyzePoem, poemStructure } from "./poems.ts";

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
  request?: BookRequest,
  expectedAttempt?: number
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
  const pptxProfile = PPTX_AGE_PROFILES[content.effectiveAgeBand];
  const selectedAgeBand = request?.ageBand ?? content.selectedAgeBand;
  if (content.selectedAgeBand !== selectedAgeBand) {
    issues.push({ level: "error", code: "selected_age_mismatch", path: "selectedAgeBand", message: "Content selected age does not match the project." });
  }
  if (request && content.language !== request.language) {
    issues.push({ level: "error", code: "book_language_mismatch", path: "language", message: `Content language ${content.language} does not match requested language ${request.language}.` });
  }
  if (expectedAttempt !== undefined && content.generationAttempt !== expectedAttempt) {
    issues.push({ level: "error", code: "generation_attempt_mismatch", path: "generationAttempt", message: "Content generation attempt does not match the active prompt." });
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
    const poem = analyzePoem(creature.poem.text);
    const structure = poemStructure(content.effectiveAgeBand);
    const poemPath = `creatures.${index}.poem`;
    if (poem.stanzas.length !== structure.stanzaCount) issues.push({ level: "error", code: "poem_stanza_count", path: `${poemPath}.text`, message: `Poem requires exactly ${structure.stanzaCount} stanzas.` });
    if (poem.stanzas.some((stanza) => stanza.length !== structure.linesPerStanza)) issues.push({ level: "error", code: "poem_line_count", path: `${poemPath}.text`, message: `Every stanza requires exactly ${structure.linesPerStanza} lines.` });
    if (creature.poem.rhymeScheme !== structure.rhymeScheme) issues.push({ level: "error", code: "poem_rhyme_scheme", path: `${poemPath}.rhymeScheme`, message: `Expected rhyme scheme ${structure.rhymeScheme}.` });
    if (poem.normalizedStanzas.some((stanza, stanzaIndex, all) => stanzaIndex > 0 && stanza === all[stanzaIndex - 1])) issues.push({ level: "error", code: "duplicate_adjacent_stanza", path: `${poemPath}.text`, message: "A poem cannot repeat the same stanza immediately." });
    if (poem.wordCount < structure.minWords || poem.wordCount > structure.maxWords) issues.push({ level: "warning", code: "poem_word_count", path: `${poemPath}.text`, message: `Poem word count should be ${structure.minWords}-${structure.maxWords} for ages ${content.effectiveAgeBand}.` });
    if (creature.poem.language !== content.language) issues.push({ level: "error", code: "poem_language_mismatch", path: `${poemPath}.language`, message: "Poem language must match the book language." });
    for (const sectionName of ["poem", "funFact", "activity"] as const) {
      const count = words(creature[sectionName].text);
      const characterCount = characters(creature[sectionName].text);
      const lineCount = explicitLines(creature[sectionName].text);
      const pptxLimit = pptxProfile.sections[sectionName];
      const characterLimit = content.language === "kn" ? Math.floor(pptxLimit.characters * 0.85) : pptxLimit.characters;
      wordCount += count;
      if (creature[sectionName].language !== content.language) {
        issues.push({ level: "error", code: "section_language_mismatch", path: `creatures.${index}.${sectionName}.language`, message: `${sectionName} language does not match the book language.` });
      }
      if (count > pptxLimit.words) {
        issues.push({
          level: "error",
          code: "section_word_overflow",
          path: `creatures.${index}.${sectionName}.text`,
          message: `${sectionName} exceeds the ${content.effectiveAgeBand} PPTX limit of ${pptxLimit.words} words.`
        });
      }
      if (characterCount > characterLimit) issues.push({ level: "error", code: "section_character_overflow", path: `creatures.${index}.${sectionName}.text`, message: `${sectionName} exceeds the ${content.effectiveAgeBand}${content.language === "kn" ? " Kannada" : ""} PPTX limit of ${characterLimit} characters.` });
      if (lineCount > pptxProfile.maxExplicitLines) issues.push({ level: "error", code: "section_line_overflow", path: `creatures.${index}.${sectionName}.text`, message: `${sectionName} exceeds the ${content.effectiveAgeBand} PPTX limit of ${pptxProfile.maxExplicitLines} explicit lines.` });
    }
    const docxLimit = DOCX_TYPOGRAPHY_BY_AGE[content.effectiveAgeBand].maxSectionWords;
    for (const sectionName of ["funFact", "activity"] as const) {
      if (words(creature[sectionName].text) > docxLimit) {
        issues.push({
          level: "error",
          code: "docx_page_overflow_risk",
          path: `creatures.${index}.${sectionName}.text`,
          message: `${sectionName} exceeds the ${docxLimit}-word DOCX page budget for ages ${content.effectiveAgeBand}.`
        });
      }
    }
    for (const [field, limit] of [
      ["illustrationBrief", DOCX_LIMITS.maxIllustrationBriefWords],
      ["altText", DOCX_LIMITS.maxAltTextWords]
    ] as const) {
      if (words(creature[field]) > limit) {
        issues.push({ level: "error", code: "docx_page_overflow_risk", path: `creatures.${index}.${field}`, message: `${field} exceeds the ${limit}-word DOCX page budget.` });
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

  if (content.closingNote && words(content.closingNote) > DOCX_LIMITS.maxClosingNoteWords) {
    issues.push({ level: "error", code: "docx_page_overflow_risk", path: "closingNote", message: `closingNote exceeds the ${DOCX_LIMITS.maxClosingNoteWords}-word DOCX page budget.` });
  }
  const pageCount = projectedPageCount(content);
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
