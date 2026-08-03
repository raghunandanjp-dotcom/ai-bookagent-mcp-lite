// Require a real Kannada letter rather than accepting an isolated combining
// mark, digit, or punctuation character from the Kannada Unicode block.
const KANNADA_LETTER = /[\u0C85-\u0CB9\u0CDC-\u0CE1\u0CF1-\u0CF2]/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

export interface KannadaScriptAnalysis {
  hasKannada: boolean;
  hasLatin: boolean;
}

export function analyzeKannadaScript(value: string): KannadaScriptAnalysis {
  const normalized = value.normalize("NFC");
  return {
    hasKannada: KANNADA_LETTER.test(normalized),
    hasLatin: LATIN_LETTER.test(normalized)
  };
}
