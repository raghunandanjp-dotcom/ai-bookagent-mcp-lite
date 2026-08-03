import type { BookContent, Creature } from "../../src/domain.ts";

export function pptxFixture(count: number, language: "en" | "kn" = "en"): { content: BookContent; approved: Creature[] } {
  const approved = Array.from({ length: count }, (_, index): Creature => ({
    id: `creature-${index + 1}`,
    name: `Creature ${index + 1}`,
    aliases: [],
    status: "living",
    groups: ["test"],
    habitats: ["test habitat"],
    pinned: false
  }));
  const kannada = "ಪ್ರಾಣಿ ಸಮುದ್ರದಲ್ಲಿ ನಿಧಾನವಾಗಿ ಈಜುತ್ತದೆ.";
  const content: BookContent = {
    schemaVersion: "1.1",
    title: language === "kn" ? "ಅದ್ಭುತ ಪ್ರಾಣಿಗಳು" : "Wonderful Creatures",
    language,
    selectedAgeBand: "6-8",
    effectiveAgeBand: "6-8",
    generationAttempt: 0,
    creatures: approved.map((creature, index) => ({
      creatureId: creature.id,
      displayName: language === "kn" ? `ಪ್ರಾಣಿ ${index + 1}` : creature.name,
      poem: {
        text: language === "kn"
          ? `${kannada}\n${kannada}\n${kannada}\n\nಹೊಸ ಬೆಳಕಿನಲ್ಲಿ ಪ್ರಾಣಿ ಸಂತೋಷವಾಗಿ ನಡೆಯುತ್ತದೆ.\n${kannada}\n${kannada}`
          : `Creature ${index + 1} dances softly tonight\nUnder stars it feels just right\nThen it rests beside a tree\n\nMorning brings a golden glow\nOff into the world we go\nHappy, curious, wild and free`,
        language,
        reviewStatus: "human_reviewed",
        title: language === "kn" ? "ಪ್ರಾಣಿಯ ಹಾಡು" : `Creature ${index + 1}'s Song`,
        structureVersion: "1.0",
        rhymeScheme: "AAB"
      },
      funFact: { text: language === "kn" ? kannada : `Creature ${index + 1} has a useful fact.`, language, reviewStatus: "source_supported" },
      activity: { text: language === "kn" ? kannada : `Draw creature ${index + 1} in its habitat.`, language, reviewStatus: "human_reviewed" },
      illustrationBrief: `A friendly view of creature ${index + 1} in its habitat.`,
      altText: `Creature ${index + 1} shown clearly in its habitat.`
    })),
    closingNote: "Keep learning about every wonderful creature."
  };
  return { content, approved };
}
