import { POEM_STRUCTURE_BY_AGE, nextAgeBand, type AgeBand } from "./domain.ts";

export function effectiveAgeBand(selected: AgeBand, attempt: number): AgeBand {
  return attempt < 2 ? selected : nextAgeBand(selected);
}

export function normalizePoemText(text: string): string {
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function analyzePoem(text: string) {
  const normalizedText = normalizePoemText(text);
  const stanzas = normalizedText.split(/\n\s*\n/u).map((stanza) => stanza.split("\n").filter(Boolean));
  const normalizedStanzas = stanzas.map((lines) => lines.join(" ").toLocaleLowerCase("en")
    .normalize("NFKC").replace(/[^\p{Letter}\p{Number}\s]/gu, "").replace(/\s+/gu, " ").trim());
  return {
    normalizedText,
    stanzas,
    normalizedStanzas,
    wordCount: normalizedText.split(/\s+/u).filter(Boolean).length
  };
}

export function poemStructure(ageBand: AgeBand) {
  return POEM_STRUCTURE_BY_AGE[ageBand];
}
