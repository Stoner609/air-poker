import { describe, expect, it } from "vitest";
import { createMatch, transition } from "./game";
import { timeoutEventFor } from "./timeout";

const pack = {
  id: "timeout-test",
  playerTargets: [22, 31, 36, 39, 47],
  aiTargets: [18, 25, 34, 44, 52],
};

describe("階段逾時", () => {
  it("組牌逾時採用最後一組總和正確的完整候選", () => {
    let state = createMatch({ seed: 42, numberPack: pack });
    state = transition(state, { type: "target-selected", player: "human", target: 22 }).state;
    state = transition(state, { type: "target-selected", player: "ai", target: 25 }).state;
    const complete = ["SA", "H2", "D3", "C7", "S9"];
    state = transition(state, { type: "draft-changed", player: "human", cardIds: complete }).state;
    state = transition(state, { type: "draft-changed", player: "human", cardIds: ["SA"] }).state;

    expect(timeoutEventFor(state, "human")).toEqual({
      type: "hand-locked",
      player: "human",
      cardIds: complete,
    });
  });
});
