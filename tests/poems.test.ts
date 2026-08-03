import { describe, expect, it } from "vitest";
import { analyzePoem, effectiveAgeBand, poemStructure } from "../src/poems.ts";

describe("poem structure", () => {
  it.each([
    ["3-5", 0, "3-5"], ["3-5", 1, "3-5"], ["3-5", 2, "6-8"],
    ["9-11", 2, "12-14"], ["12-14", 2, "12-14"]
  ] as const)("resolves %s attempt %s", (selected, attempt, expected) => {
    expect(effectiveAgeBand(selected, attempt)).toBe(expected);
  });

  it("defines the approved age defaults", () => {
    expect(poemStructure("3-5")).toMatchObject({ stanzaCount: 2, linesPerStanza: 2, rhymeScheme: "AA" });
    expect(poemStructure("12-14")).toMatchObject({ stanzaCount: 4, linesPerStanza: 3, rhymeScheme: "AAB" });
  });

  it("normalizes line endings and detects adjacent stanza repetition", () => {
    const result = analyzePoem("One\r\nTwo\r\n\r\nOne\r\nTwo");
    expect(result.stanzas).toHaveLength(2);
    expect(result.normalizedStanzas[0]).toBe(result.normalizedStanzas[1]);
  });
});
