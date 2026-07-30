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

describe("content validation", () => {
  it("reports creature coverage and fact review", () => {
    const result = validateBookContent({
      schemaVersion: "1.0",
      title: "Ocean Friends",
      language: "en",
      creatures: [{
        creatureId: "octopus",
        displayName: "Octopus",
        poem: section("Eight arms wave in the sea."),
        funFact: section("An octopus has three hearts."),
        activity: section("Draw eight arms and count them."),
        illustrationBrief: "A friendly octopus underwater.",
        altText: "A smiling octopus with eight visible arms."
      }]
    }, approved);
    expect(result.report.valid).toBe(true);
    expect(result.report.creaturesCovered).toEqual(["Octopus"]);
    expect(result.report.issues.some((issue) => issue.code === "fact_review_required")).toBe(true);
  });

  it("rejects unapproved creatures", () => {
    const result = validateBookContent({
      schemaVersion: "1.0",
      title: "Ocean Friends",
      language: "en",
      creatures: [{
        creatureId: "dolphin",
        displayName: "Dolphin",
        poem: section("A dolphin leaps."),
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
});
