import { describe, expect, it } from "vitest";
import { createMatch, transition } from "./game";
import { createAiView, chooseAiBettingAction, chooseAiHand, chooseAiTarget } from "./ai";
import { solveHands } from "./solver";

const pack = {
  id: "ai-test",
  playerTargets: [22, 31, 36, 39, 47],
  aiTargets: [18, 25, 34, 44, 52],
};

describe("公平且可重現的 AI", () => {
  it("目標數字決策只依賴 AI 合法可見資訊，且相同 seed 產生相同結果", () => {
    let state = createMatch({ seed: 947, numberPack: pack });
    state = transition(state, {
      type: "target-selected",
      player: "human",
      target: 39,
    }).state;

    const view = createAiView(state);
    expect(view.opponent).not.toHaveProperty("targets");
    expect(view.opponent).not.toHaveProperty("lockedCards");

    const first = chooseAiTarget(view);
    const second = chooseAiTarget(createAiView(state));
    expect(first).toBe(second);
    expect(pack.aiTargets).toContain(first);
  });

  it("從合法解中做可重現的非完美選擇，並依牌力產生合法下注", () => {
    let state = createMatch({ seed: 947, numberPack: pack });
    state = transition(state, { type: "target-selected", player: "human", target: 39 }).state;
    state = transition(state, { type: "target-selected", player: "ai", target: 25 }).state;
    const view = createAiView(state);
    const solutions = solveHands({ target: 25, availableCardIds: view.availableCardIds, limit: 20 });
    const chosen = chooseAiHand(view, solutions);

    expect(solutions.map((solution) => solution.cardIds)).toContainEqual(chosen.cardIds);
    expect(chooseAiHand(view, solutions)).toEqual(chosen);

    const action = chooseAiBettingAction(
      { ...view, phase: "betting", currentActor: "ai" },
      chosen,
    );
    expect(["check", "bet"]).toContain(action.action);
  });
});
