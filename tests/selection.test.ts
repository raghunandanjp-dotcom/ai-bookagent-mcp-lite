import { describe, expect, it } from "vitest";
import { beginSelection, batchCreatures } from "../src/selection.ts";
import type { Creature } from "../src/domain.ts";

const creature = (id: string, aliases: string[] = []): Creature => ({
  id,
  name: id.replaceAll("-", " "),
  aliases,
  status: "living",
  groups: [],
  habitats: [],
  pinned: false
});

describe("creature selection", () => {
  it("batches more than ten creatures in groups of five", () => {
    const creatures = Array.from({ length: 11 }, (_, index) => creature(`creature-${index}`));
    expect(batchCreatures(creatures).map((batch) => batch.length)).toEqual([5, 5, 1]);
  });

  it("rejects alias reuse when previous creatures are excluded", () => {
    const initial = beginSelection([creature("orca", ["killer whale"])]);
    expect(() => beginSelection([creature("killer-whale")], initial, true)).toThrow(/reused excluded creature/i);
  });

  it("permits only two usable full-list regenerations", () => {
    const first = beginSelection([creature("orca")]);
    const second = beginSelection([creature("dolphin")], first);
    const third = beginSelection([creature("seal")], second);
    expect(() => beginSelection([creature("walrus")], third)).toThrow(/two creature-list regenerations/i);
  });
});
