import { describe, expect, it } from "vitest";
import { validateBookContent } from "../src/validation.ts";
import type { Creature } from "../src/domain.ts";

const approved: Creature[] = [{
  id: "octopus",
  name: "Octopus",
  aliases: [],
  status: "living",
  groups: ["mollusc"],
  habitats: ["ocean"],
  pinned: false
}];

const section = (text: string) => ({ text, language: "en" as const, reviewStatus: "needs_review" as const });
const poem = (text = "Wave hello beneath the sea\nSwim along so happily\n\nOctopus peeks from a cave\nThen it gives another wave") => ({ ...section(text), title: "Octopus Waves", structureVersion: "1.0" as const, rhymeScheme: "AA" as const });

describe("content validation", () => {
  it("reports creature coverage and fact review", () => {
    const result = validateBookContent({
      schemaVersion: "1.1", selectedAgeBand: "3-5", effectiveAgeBand: "3-5", generationAttempt: 0,
      title: "Ocean Friends",
      language: "en",
      creatures: [{
        creatureId: "octopus",
        displayName: "Octopus",
        poem: poem(),
        funFact: section("An octopus has three hearts."),
        activity: section("Draw eight arms and count them."),
        illustrationBrief: "A friendly octopus underwater.",
        altText: "A smiling octopus with eight visible arms."
      }]
    }, approved, { title: "Ocean Friends", theme: "ocean", ageBand: "3-5", language: "en", creatureCount: 1, brief: "", allowMythical: false, outputFormats: ["docx"] });
    expect(result.report.valid).toBe(true);
    expect(result.report.creaturesCovered).toEqual(["Octopus"]);
    expect(result.report.issues.some((issue) => issue.code === "fact_review_required")).toBe(true);
  });

  it("rejects unapproved creatures", () => {
    const result = validateBookContent({
      schemaVersion: "1.1", selectedAgeBand: "3-5", effectiveAgeBand: "3-5", generationAttempt: 0,
      title: "Ocean Friends",
      language: "en",
      creatures: [{
        creatureId: "dolphin",
        displayName: "Dolphin",
        poem: poem(),
        funFact: section("Dolphins breathe air."),
        activity: section("Pretend to leap."),
        illustrationBrief: "A dolphin.",
        altText: "A dolphin jumping."
      }]
    }, approved);
    expect(result.report.valid).toBe(false);
    expect(result.report.missingCreatureIds).toEqual(["octopus"]);
    expect(result.report.unexpectedCreatureIds).toEqual(["dolphin"]);
  });

  it("counts an optional closing page", () => {
    const input = {
      schemaVersion: "1.1", selectedAgeBand: "3-5", effectiveAgeBand: "3-5", generationAttempt: 0,
      title: "Ocean Friends", language: "en", closingNote: "Keep exploring!",
      creatures: [{ creatureId: "octopus", displayName: "Octopus", poem: poem(), funFact: section("Three hearts."), activity: section("Count eight arms."), illustrationBrief: "A friendly octopus.", altText: "An octopus." }]
    };
    expect(validateBookContent(input, approved).report.pageCount).toBe(5);
  });

  it("blocks DOCX content that exceeds the age-specific page budget", () => {
    const longText = Array.from({ length: 71 }, () => "word").join(" ");
    const input = {
      schemaVersion: "1.1", selectedAgeBand: "3-5", effectiveAgeBand: "3-5", generationAttempt: 0,
      title: "Ocean Friends", language: "en",
      creatures: [{ creatureId: "octopus", displayName: "Octopus", poem: poem(), funFact: section(longText), activity: section("Count eight arms."), illustrationBrief: "A friendly octopus.", altText: "An octopus." }]
    };
    const result = validateBookContent(input, approved);
    expect(result.report.valid).toBe(false);
    expect(result.report.issues).toContainEqual(expect.objectContaining({ code: "docx_page_overflow_risk", path: "creatures.0.funFact.text" }));
  });
});
