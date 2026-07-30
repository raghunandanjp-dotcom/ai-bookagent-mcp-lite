import { createHash } from "node:crypto";
import {
  LIMITS,
  type Creature,
  type SelectionState
} from "./domain.ts";

export function slugifyCreatureName(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/['’]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `creature-${createHash("sha256").update(value).digest("hex").slice(0, 10)}`;
}

export function canonicalKeys(creature: Creature): Set<string> {
  return new Set(
    [creature.id, creature.name, creature.scientificName, ...creature.aliases]
      .filter((value): value is string => Boolean(value))
      .map(slugifyCreatureName)
  );
}

export function assertNoDuplicateCreatures(creatures: Creature[]): void {
  const seen = new Map<string, string>();
  for (const creature of creatures) {
    for (const key of canonicalKeys(creature)) {
      const prior = seen.get(key);
      if (prior && prior !== creature.id) {
        throw new Error(`Duplicate creature aliases detected: ${prior} and ${creature.id} share "${key}".`);
      }
      seen.set(key, creature.id);
    }
  }
}

export function beginSelection(
  creatures: Creature[],
  previous?: SelectionState,
  excludePrevious = false
): SelectionState {
  if (creatures.length > LIMITS.maxCreatures) {
    throw new Error(`Creature count exceeds the hard limit of ${LIMITS.maxCreatures}.`);
  }
  assertNoDuplicateCreatures(creatures);

  const state: SelectionState = previous ?? {
    regenerationsUsed: 0,
    approved: false,
    current: [],
    history: [],
    cumulativeExclusions: []
  };
  const isRegeneration = state.current.length > 0;
  if (isRegeneration && state.regenerationsUsed >= LIMITS.maxRegenerations) {
    throw new Error("The two creature-list regenerations have already been used.");
  }

  const priorKeys = new Set(state.cumulativeExclusions.map(slugifyCreatureName));
  if (excludePrevious) {
    for (const prior of state.current) {
      for (const key of canonicalKeys(prior)) priorKeys.add(key);
    }
    for (const creature of creatures) {
      const collision = [...canonicalKeys(creature)].find((key) => priorKeys.has(key));
      if (collision) throw new Error(`Regenerated selection reused excluded creature "${creature.name}".`);
    }
  }

  const nextRegenerationsUsed = state.regenerationsUsed + (isRegeneration ? 1 : 0);
  const nextExclusions = excludePrevious
    ? Array.from(new Set([...priorKeys, ...state.cumulativeExclusions]))
    : state.cumulativeExclusions;

  return {
    regenerationsUsed: nextRegenerationsUsed,
    approved: false,
    current: creatures,
    cumulativeExclusions: nextExclusions,
    history: [
      ...state.history,
      {
        attempt: nextRegenerationsUsed,
        createdAt: new Date().toISOString(),
        creatureIds: creatures.map((creature) => creature.id),
        excludedPrevious: excludePrevious
      }
    ]
  };
}

export function approveSelection(state: SelectionState): SelectionState {
  if (state.current.length === 0) throw new Error("Cannot approve an empty creature selection.");
  return { ...state, approved: true };
}

export function batchCreatures(creatures: Creature[]): Creature[][] {
  const size = creatures.length > LIMITS.batchThreshold ? LIMITS.batchSize : creatures.length;
  if (size === 0) return [];
  return Array.from({ length: Math.ceil(creatures.length / size) }, (_, index) =>
    creatures.slice(index * size, (index + 1) * size)
  );
}
