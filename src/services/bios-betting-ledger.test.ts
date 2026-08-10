import { describe, expect, it } from "vitest";
import { createMatch, transition, type GameEvent } from "../domain/game";
import { NUMBER_PACKS } from "../content/number-packs";
import type { RecordedEvent } from "./match-repository";
import {
  projectBiosBettingLedger,
  projectCompletedBiosLedgers,
} from "./bios-betting-ledger";

function bettingRecord() {
  const initial = createMatch({ seed: 42, numberPack: NUMBER_PACKS[0] });
  let state = initial;
  const events: RecordedEvent[] = [
    { sequence: 0, at: 0, event: { type: "match-created" }, state: initial },
  ];

  const apply = (event: GameEvent) => {
    state = transition(state, event).state;
    events.push({ sequence: events.length, at: events.length, event });
  };

  apply({ type: "target-selected", player: "human", target: initial.players.human.targets[0] });
  apply({ type: "target-selected", player: "ai", target: initial.players.ai.targets[0] });
  apply({ type: "hand-locked", player: "human", cardIds: ["SA", "H2", "D3", "C7", "S9"] });
  apply({ type: "hand-locked", player: "ai", cardIds: ["S3", "H4", "D5", "C6", "S7"] });

  return {
    get state() {
      return state;
    },
    events,
    apply,
  };
}

describe("BIOS 下注籌碼投影", () => {
  it("從參加費建立雙方當局的初始籌碼軌", () => {
    const initial = createMatch({ seed: 42, numberPack: NUMBER_PACKS[0] });
    const events: RecordedEvent[] = [
      { sequence: 0, at: 0, event: { type: "match-created" }, state: initial },
    ];

    const ledger = projectBiosBettingLedger(events, initial);

    expect(ledger.players.human.chips).toEqual([
      { id: "0:human:ante", player: "human", kind: "ante", amount: 1, status: "neutral", sequence: 0 },
    ]);
    expect(ledger.players.ai.chips[0]).toMatchObject({
      player: "ai",
      kind: "ante",
      amount: 1,
      status: "neutral",
    });
  });

  it("從事件前狀態拆出下注、隱式跟注與額外加注", () => {
    const record = bettingRecord();
    record.apply({ type: "betting-action", player: "human", action: "bet", amount: 1 });
    record.apply({ type: "betting-action", player: "ai", action: "raise", amount: 2 });
    record.apply({ type: "betting-action", player: "human", action: "raise", amount: 2 });

    const ledger = projectBiosBettingLedger(record.events, record.state);

    expect(ledger.players.human.chips).toEqual([
      expect.objectContaining({ kind: "ante", amount: 1, status: "neutral" }),
      expect.objectContaining({ kind: "bet", amount: 1, status: "completed" }),
      expect.objectContaining({ kind: "call", amount: 2, status: "completed" }),
      expect.objectContaining({ kind: "raise", amount: 2, status: "latest" }),
    ]);
    expect(ledger.players.ai.chips).toEqual([
      expect.objectContaining({ kind: "ante", amount: 1, status: "neutral" }),
      expect.objectContaining({ kind: "call", amount: 1, status: "completed" }),
      expect.objectContaining({ kind: "raise", amount: 2, status: "completed" }),
    ]);
    expect(ledger.players.human.chips.reduce((total, chip) => total + chip.amount, 0)).toBe(
      record.state.players.human.invested,
    );
    expect(ledger.players.ai.chips.reduce((total, chip) => total + chip.amount, 0)).toBe(
      record.state.players.ai.invested,
    );
    expect(
      [...ledger.players.human.chips, ...ledger.players.ai.chips].reduce(
        (total, chip) => total + chip.amount,
        0,
      ),
    ).toBe(record.state.pot);
  });

  it("不把過牌或棄牌投影成 BIOS 籌碼，且重播不依賴每筆事件的 state 快照", () => {
    const record = bettingRecord();
    record.apply({ type: "betting-action", player: "human", action: "check" });
    record.apply({ type: "betting-action", player: "ai", action: "fold" });

    const ledger = projectBiosBettingLedger(record.events, record.state);

    expect(ledger.players.human.chips).toHaveLength(1);
    expect(ledger.players.ai.chips).toHaveLength(1);
    expect(ledger.players.human.invested).toBe(2);
    expect(ledger.players.ai.invested).toBe(2);
  });

  it("修正選牌仍停留在同一局，保留當局籌碼而不產生歷史摘要", () => {
    const record = bettingRecord();
    record.apply({ type: "betting-action", player: "human", action: "check" });
    record.apply({ type: "betting-action", player: "ai", action: "check" });

    expect(record.state.phase).toBe("correction");
    expect(record.state.round).toBe(1);
    expect(projectCompletedBiosLedgers(record.events, record.state)).toEqual([]);
    expect(projectBiosBettingLedger(record.events, record.state).players.human.chips).toEqual([
      expect.objectContaining({ kind: "ante", amount: 1, status: "completed" }),
    ]);
  });

  it("能投影結束局的顯式跟注，並在事件重播後保持相同結果", () => {
    const record = bettingRecord();
    record.apply({ type: "betting-action", player: "human", action: "bet", amount: 1 });
    record.apply({ type: "betting-action", player: "ai", action: "call" });

    const ledger = projectBiosBettingLedger(record.events, record.state, 1);
    const reloadedLedger = projectBiosBettingLedger(
      structuredClone(record.events),
      structuredClone(record.state),
      1,
    );

    expect(ledger).toEqual(reloadedLedger);
    expect(ledger.players.ai.chips).toEqual([
      expect.objectContaining({ kind: "ante", amount: 1, status: "completed" }),
      expect.objectContaining({ kind: "call", amount: 1, status: "completed" }),
    ]);
  });

  it("從已完成局的歷史事件建立雙方投入摘要，不把修正局算成新局", () => {
    const record = bettingRecord();
    record.apply({ type: "betting-action", player: "human", action: "bet", amount: 1 });
    record.apply({ type: "betting-action", player: "ai", action: "fold" });

    const ledgers = projectCompletedBiosLedgers(record.events, record.state);
    const replayedStateWithoutHistory = structuredClone(record.state);
    replayedStateWithoutHistory.history = [];
    const reloadedLedgers = projectCompletedBiosLedgers(record.events, replayedStateWithoutHistory);

    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]).toMatchObject({
      round: 1,
      players: {
        human: { invested: 2 },
        ai: { invested: 1 },
      },
    });
    expect(ledgers[0].players.human.chips.every((chip) => chip.status === "completed")).toBe(true);
    expect(reloadedLedgers).toEqual(ledgers);
  });
});
