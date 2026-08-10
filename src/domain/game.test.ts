import { describe, expect, it } from "vitest";
import { createMatch, transition } from "./game";

const pack = {
  id: "test-pack",
  playerTargets: [22, 31, 36, 39, 47],
  aiTargets: [18, 25, 34, 44, 52],
};

describe("對局引擎", () => {
  function readyForBetting() {
    let state = createMatch({ seed: 42, numberPack: pack });
    state = transition(state, { type: "target-selected", player: "human", target: 22 }).state;
    state = transition(state, { type: "target-selected", player: "ai", target: 25 }).state;
    state = transition(state, {
      type: "hand-locked",
      player: "human",
      cardIds: ["SA", "H2", "D3", "C7", "S9"],
    }).state;
    return transition(state, {
      type: "hand-locked",
      player: "ai",
      cardIds: ["S3", "H4", "D5", "C6", "S7"],
    }).state;
  }

  it("建立第一局時收取雙方 1 BIOS 參加費", () => {
    const match = createMatch({ seed: 42, numberPack: pack });

    expect(match).toMatchObject({
      round: 1,
      phase: "number-selection",
      pot: 2,
      players: {
        human: { bios: 24, targets: pack.playerTargets, invested: 1 },
        ai: { bios: 24, targets: pack.aiTargets, invested: 1 },
      },
    });
  });

  it("雙方祕密選定數字後同時公開，第一局由較小數字者先行", () => {
    const initial = createMatch({ seed: 42, numberPack: pack });
    const afterHuman = transition(initial, {
      type: "target-selected",
      player: "human",
      target: 31,
    }).state;
    const revealed = transition(afterHuman, {
      type: "target-selected",
      player: "ai",
      target: 18,
    }).state;

    expect(afterHuman.phase).toBe("number-selection");
    expect(revealed).toMatchObject({
      phase: "construction",
      firstPlayer: "ai",
      players: {
        human: { selectedTarget: 31 },
        ai: { selectedTarget: 18 },
      },
    });
  });

  it("雙方鎖定後才進入下注，且鎖定牌在下注中不可修改", () => {
    let state = createMatch({ seed: 42, numberPack: pack });
    state = transition(state, { type: "target-selected", player: "human", target: 22 }).state;
    state = transition(state, { type: "target-selected", player: "ai", target: 25 }).state;
    state = transition(state, {
      type: "hand-locked",
      player: "human",
      cardIds: ["SA", "H2", "D3", "C7", "S9"],
    }).state;

    expect(state.phase).toBe("construction");

    state = transition(state, {
      type: "hand-locked",
      player: "ai",
      cardIds: ["S3", "H4", "D5", "C6", "S7"],
    }).state;

    expect(state).toMatchObject({ phase: "betting", currentActor: "human" });
    expect(() =>
      transition(state, {
        type: "hand-locked",
        player: "human",
        cardIds: ["SA", "H2", "D3", "C4", "S5"],
      }),
    ).toThrow("目前不能鎖定牌組");
  });

  it("棄牌後對手取得底池，雙方鎖定的可用牌仍被使用，接著收取下一局參加費", () => {
    const state = transition(readyForBetting(), {
      type: "betting-action",
      player: "human",
      action: "fold",
    }).state;

    expect(state).toMatchObject({
      round: 2,
      phase: "number-selection",
      pot: 4,
      players: {
        human: { bios: 22, usedTargets: [22], invested: 2 },
        ai: { bios: 24, usedTargets: [25], invested: 2 },
      },
      history: [{ round: 1, outcome: "fold", winner: "ai" }],
    });
    expect(state.availableCardIds).not.toContain("SA");
    expect(state.availableCardIds).not.toContain("S7");
  });

  it("雙方連續過牌後攤牌，以牌型決定底池歸屬", () => {
    let state = readyForBetting();
    state = transition(state, {
      type: "betting-action",
      player: "human",
      action: "check",
    }).state;
    state = transition(state, {
      type: "betting-action",
      player: "ai",
      action: "check",
    }).state;

    expect(state).toMatchObject({
      round: 2,
      phase: "number-selection",
      history: [{ outcome: "showdown", winner: "ai", conflict: false }],
    });
  });

  it("雙方同時無效時保留原數字、底池與牌張狀態進入修正選牌", () => {
    let state = createMatch({ seed: 42, numberPack: pack });
    state = transition(state, { type: "target-selected", player: "human", target: 22 }).state;
    state = transition(state, { type: "target-selected", player: "ai", target: 25 }).state;
    state = transition(state, {
      type: "hand-locked",
      player: "human",
      cardIds: ["SA", "HA", "DA", "CA", "S2"],
    }).state;
    state = transition(state, {
      type: "hand-locked",
      player: "ai",
      cardIds: ["S2", "H2", "D2", "C2", "S3"],
    }).state;
    state = transition(state, { type: "betting-action", player: "human", action: "check" }).state;
    state = transition(state, { type: "betting-action", player: "ai", action: "check" }).state;

    expect(state).toMatchObject({
      round: 1,
      phase: "correction",
      pot: 2,
      correctionAttempt: 1,
      availableCardIds: expect.arrayContaining(["SA", "S2"]),
      players: {
        human: { selectedTarget: 22, lockedCards: undefined },
        ai: { selectedTarget: 25, lockedCards: undefined },
      },
    });
  });

  it("限制首次下注為半池，跟注後立即攤牌", () => {
    const initial = readyForBetting();
    expect(() =>
      transition(initial, {
        type: "betting-action",
        player: "human",
        action: "bet",
        amount: 2,
      }),
    ).toThrow("下注上限為 1 BIOS");

    let state = transition(initial, {
      type: "betting-action",
      player: "human",
      action: "bet",
      amount: 1,
    }).state;
    expect(state).toMatchObject({
      pot: 3,
      currentActor: "ai",
      players: { human: { bios: 23, invested: 2 } },
    });

    state = transition(state, {
      type: "betting-action",
      player: "ai",
      action: "call",
    }).state;
    expect(state).toMatchObject({
      round: 2,
      players: { human: { bios: 21 }, ai: { bios: 25 } },
    });
  });

  it("再加注先補足跟注差額，再以完成跟注後的半池計算上限", () => {
    let state = transition(readyForBetting(), {
      type: "betting-action",
      player: "human",
      action: "bet",
      amount: 1,
    }).state;

    expect(() =>
      transition(state, {
        type: "betting-action",
        player: "ai",
        action: "raise",
        amount: 3,
      }),
    ).toThrow("加注上限為 2 BIOS");

    state = transition(state, {
      type: "betting-action",
      player: "ai",
      action: "raise",
      amount: 2,
    }).state;
    expect(state).toMatchObject({
      pot: 6,
      currentActor: "human",
      players: { ai: { bios: 21, invested: 4 } },
    });

    state = transition(state, {
      type: "betting-action",
      player: "human",
      action: "call",
    }).state;
    expect(state).toMatchObject({
      round: 2,
      players: { human: { bios: 19 }, ai: { bios: 27 } },
    });
  });

  it("第二局起由上一局後行者先行，不再比較目標數字", () => {
    let state = transition(readyForBetting(), {
      type: "betting-action",
      player: "human",
      action: "fold",
    }).state;
    state = transition(state, { type: "target-selected", player: "human", target: 31 }).state;
    state = transition(state, { type: "target-selected", player: "ai", target: 52 }).state;

    expect(state).toMatchObject({ round: 2, phase: "construction", firstPlayer: "ai" });
  });

  it("雙方有效且分出勝負時，牌張衝突只向敗者收取一次局數等額 BIOS", () => {
    let state = createMatch({ seed: 42, numberPack: pack });
    state = transition(state, { type: "target-selected", player: "human", target: 22 }).state;
    state = transition(state, { type: "target-selected", player: "ai", target: 25 }).state;
    state = transition(state, {
      type: "hand-locked",
      player: "human",
      cardIds: ["SA", "H2", "S3", "C7", "S9"],
    }).state;
    state = transition(state, {
      type: "hand-locked",
      player: "ai",
      cardIds: ["S3", "H4", "D5", "C6", "S7"],
    }).state;
    state = transition(state, { type: "betting-action", player: "human", action: "check" }).state;
    state = transition(state, { type: "betting-action", player: "ai", action: "check" }).state;

    expect(state.history[0]).toMatchObject({ winner: "ai", conflict: true });
    expect(state.players.human.bios).toBe(21);
    expect(state.players.ai.bios).toBe(24);
  });

  it("雙方使用完全相同的有效牌而平手時，只平分底池且不收取衝突損失", () => {
    const tiePack = {
      ...pack,
      playerTargets: [25, 31, 36, 39, 47],
    };
    let state = createMatch({ seed: 42, numberPack: tiePack });
    state = transition(state, { type: "target-selected", player: "human", target: 25 }).state;
    state = transition(state, { type: "target-selected", player: "ai", target: 25 }).state;
    const sameHand = ["S3", "H4", "D5", "C6", "S7"];
    state = transition(state, { type: "hand-locked", player: "human", cardIds: sameHand }).state;
    state = transition(state, { type: "hand-locked", player: "ai", cardIds: sameHand }).state;
    state = transition(state, { type: "betting-action", player: "human", action: "check" }).state;
    state = transition(state, { type: "betting-action", player: "ai", action: "check" }).state;

    expect(state.history[0]).toMatchObject({ outcome: "tie", winner: undefined, conflict: true });
    expect(state.history[0].biosAfter).toEqual({ human: 25, ai: 25 });
  });

  it("玩家可保存最多三組候選組合並切換回目前組牌槽", () => {
    let state = createMatch({ seed: 42, numberPack: pack });
    state = transition(state, { type: "target-selected", player: "human", target: 22 }).state;
    state = transition(state, { type: "target-selected", player: "ai", target: 25 }).state;
    const candidate = ["SA", "H2", "D3", "C7", "S9"];
    state = transition(state, { type: "draft-changed", player: "human", cardIds: candidate }).state;
    state = transition(state, { type: "candidate-saved", player: "human" }).state;
    state = transition(state, { type: "draft-changed", player: "human", cardIds: [] }).state;
    state = transition(state, { type: "candidate-selected", player: "human", index: 0 }).state;

    expect(state.players.human).toMatchObject({
      draft: candidate,
      savedCandidates: [candidate],
    });
  });
});
