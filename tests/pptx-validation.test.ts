import { describe, expect, it } from "vitest";
import { PPTX_AGE_PROFILES, type BookRequest } from "../src/domain.ts";
import { validateBookContent } from "../src/validation.ts";
import { pptxFixture } from "./fixtures/pptx-content.ts";

const context = (ageBand: BookRequest["ageBand"], language: BookRequest["language"] = "en") => ({ ageBand, language });

describe("PPTX density validation", () => {
  for (const ageBand of Object.keys(PPTX_AGE_PROFILES) as BookRequest["ageBand"][]) {
    it(`accepts bounded ${ageBand} content and rejects overflow`, () => {
      const { content, approved } = pptxFixture(1);
      content.selectedAgeBand = ageBand;
      content.effectiveAgeBand = ageBand;
      const limit = PPTX_AGE_PROFILES[ageBand].sections.funFact.words;
      content.creatures[0]!.funFact.text = Array.from({ length: limit }, () => "word").join(" ");
      expect(validateBookContent(content, approved, context(ageBand)).report.issues.some((issue) => issue.code === "section_word_overflow" && issue.path.endsWith("funFact.text"))).toBe(false);
      content.creatures[0]!.funFact.text += " word";
      const report = validateBookContent(content, approved, context(ageBand)).report;
      expect(report.valid).toBe(false);
      expect(report.issues.some((issue) => issue.code === "section_word_overflow")).toBe(true);
    });
  }

  it("rejects character, explicit-line, and section-language overflow", () => {
    const { content, approved } = pptxFixture(1);
    content.creatures[0]!.funFact.text = "x".repeat(PPTX_AGE_PROFILES["6-8"].sections.funFact.characters + 1);
    content.creatures[0]!.activity.text = Array.from({ length: 11 }, () => "line").join("\n");
    content.creatures[0]!.poem.language = "kn";
    const report = validateBookContent(content, approved, context("6-8")).report;
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "section_character_overflow", "section_line_overflow", "section_language_mismatch"
    ]));
  });

  it("marks Kannada font availability as an experimental warning", () => {
    const { content, approved } = pptxFixture(1, "kn");
    const report = validateBookContent(content, approved, context("6-8", "kn")).report;
    expect(report.valid).toBe(true);
    expect(report.issues.some((issue) => issue.code === "kannada_pptx_font_required" && issue.level === "warning")).toBe(true);
  });
});
