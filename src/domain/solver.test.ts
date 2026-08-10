import { describe, expect, it } from "vitest";
import { createDeck, evaluateSubmission } from "./hand";
import { solveHands } from "./solver";

describe("精確求解器", () => {
  it("找出目標 25 的最強合法牌，並將同花順排在第一位", () => {
    const availableCardIds = createDeck().map((card) => card.id);
    const solutions = solveHands({ target: 25, availableCardIds, limit: 20 });

    expect(solutions.length).toBeGreaterThan(0);
    expect(solutions[0].hand.category).toBe("straight-flush");
    for (const solution of solutions) {
      expect(
        evaluateSubmission({
          cardIds: solution.cardIds,
          target: 25,
          availableCardIds,
        }).valid,
      ).toBe(true);
    }
  });
});
