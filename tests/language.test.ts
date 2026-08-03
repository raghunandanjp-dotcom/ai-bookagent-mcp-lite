import { describe, expect, it } from "vitest";
import { analyzeKannadaScript } from "../src/language.ts";
import { prepareAuthoringPrompts } from "../src/prompts.ts";

describe("Kannada script analysis", () => {
  it("normalizes Kannada and ignores neutral punctuation and digits", () => {
    expect(analyzeKannadaScript("ಸಮುದ್ರದ ಆಟ — 10!")).toEqual({ hasKannada: true, hasLatin: false });
  });

  it("detects Latin letters mixed into Kannada", () => {
    expect(analyzeKannadaScript("Ocean ಸಮುದ್ರ")).toEqual({ hasKannada: true, hasLatin: true });
  });

  it("does not treat Kannada digits or marks alone as Kannada prose", () => {
    expect(analyzeKannadaScript("೧೦ ್")).toEqual({ hasKannada: false, hasLatin: false });
  });

  it("activates native Kannada generation from the language choice while accepting an English brief", () => {
    const prompts = prepareAuthoringPrompts({
      title: "Create a sea-creature book",
      theme: "ocean",
      ageBand: "3-5",
      language: "kn",
      creatureCount: 1,
      brief: "Make the book playful and calm.",
      allowMythical: false,
      outputFormats: ["docx"]
    }, [{
      id: "octopus", name: "Octopus", aliases: [], status: "living",
      groups: ["mollusc"], habitats: ["ocean"], pinned: false
    }]);

    expect(prompts.batches[0].prompt).toContain("source brief may be written in English");
    expect(prompts.batches[0].prompt).toContain("natively in Kannada script");
    expect(prompts.batches[0].prompt).toContain("Kannada is experimental");
    expect(prompts.batches[0].prompt).toContain("Make the book playful and calm.");
  });
});
