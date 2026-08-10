import { describe, expect, it } from "vitest";
import { createDeck } from "../domain/hand";
import { NUMBER_PACKS } from "./number-packs";

describe("固定數字包題庫", () => {
  it("包含 30 組可重現且全局可解的數字包", () => {
    const deck = new Map(createDeck().map((card) => [card.id, card]));

    expect(NUMBER_PACKS).toHaveLength(30);
    for (const pack of NUMBER_PACKS) {
      expect(new Set(pack.playerTargets).size).toBe(5);
      expect(new Set(pack.aiTargets).size).toBe(5);
      expect(pack.baselineHands).toHaveLength(10);

      const used = pack.baselineHands.flat();
      expect(new Set(used).size).toBe(50);
      expect(new Set([...used, ...pack.reserveCardIds]).size).toBe(52);

      const sums = pack.baselineHands.map((hand) =>
        hand.reduce((sum, id) => sum + deck.get(id)!.value, 0),
      );
      expect(sums.slice(0, 5)).toEqual(pack.playerTargets);
      expect(sums.slice(5)).toEqual(pack.aiTargets);

      const targetTotal = [...pack.playerTargets, ...pack.aiTargets].reduce(
        (sum, target) => sum + target,
        0,
      );
      expect(targetTotal).toBeGreaterThanOrEqual(348);
      expect(targetTotal).toBeLessThanOrEqual(358);
    }
  });
});
