import { describe, expect, it } from "vitest";
import { createMatch, transition, type GameEvent } from "../domain/game";
import type { RecordedEvent } from "./match-repository";
import { projectBiosBettingLedger } from "./bios-betting-ledger";
import {
  classifyBiosBettingBeat,
  projectBiosBettingBeatLedger,
  type BiosBettingBeat,
} from "./bios-betting-beat";

const pack = {
  id: "beat-test-pack",
  playerTargets: [22, 31, 36, 39, 47],
  aiTargets: [18, 25, 34, 44, 52],
};

function bettingRecord() {
  const initial = createMatch({ seed: 42, numberPack: pack });
  let state = initial;
  const events: RecordedEvent[] = [
    { sequence: 0, at: 0, event: { type: "match-created" }, state: initial },
  ];

  const apply = (event: GameEvent) => {
    const before = state;
    state = transition(state, event).state;
    events.push({ sequence: events.length, at: events.length, event });
    return { before, after: state, event };
  };

  apply({ type: "target-selected", player: "human", target: 22 });
  apply({ type: "target-selected", player: "ai", target: 25 });
  apply({ type: "hand-locked", player: "human", cardIds: ["SA", "H2", "D3", "C7", "S9"] });
  apply({ type: "hand-locked", player: "ai", cardIds: ["S3", "H4", "D5", "C6", "S7"] });

  return { events, get state() { return state; }, apply };
}

describe("BIOS 下注節拍投影", () => {
  it("將未結束的 AI 加注辨識為 AI 節拍，而不是延遲正式狀態", () => {
    const record = bettingRecord();
    record.apply({ type: "betting-action", player: "human", action: "bet", amount: 1 });
    const result = record.apply({ type: "betting-action", player: "ai", action: "raise", amount: 2 });

    expect(classifyBiosBettingBeat(result.event, result.before, result.after, 6)).toEqual({
      kind: "ai-raise",
      round: 1,
      sequence: 6,
      player: "ai",
      action: "raise",
    });
    expect(result.after.phase).toBe("betting");
    expect(result.after.currentActor).toBe("human");
  });

  it("將跟注或棄牌等結束下注的正式行動辨識為結算節拍", () => {
    const record = bettingRecord();
    record.apply({ type: "betting-action", player: "human", action: "bet", amount: 1 });
    const result = record.apply({ type: "betting-action", player: "ai", action: "call" });

    expect(classifyBiosBettingBeat(result.event, result.before, result.after, 6)).toMatchObject({
      kind: "settlement",
      round: 1,
      player: "ai",
      action: "call",
    });
    expect(result.after.history).toHaveLength(1);
  });

  it("雙方連續過牌進入攤牌時也建立結算節拍", () => {
    const record = bettingRecord();
    record.apply({ type: "betting-action", player: "human", action: "check" });
    const result = record.apply({ type: "betting-action", player: "ai", action: "check" });

    expect(classifyBiosBettingBeat(result.event, result.before, result.after, 6)).toMatchObject({
      kind: "settlement",
      action: "check",
    });
    expect(result.after.history).toHaveLength(1);
  });

  it("AI 加注節拍先只顯示青藍跟注，正式加注仍保留在事件投影", () => {
    const record = bettingRecord();
    record.apply({ type: "betting-action", player: "human", action: "bet", amount: 1 });
    const result = record.apply({ type: "betting-action", player: "ai", action: "raise", amount: 2 });
    const ledger = projectBiosBettingLedger(record.events, record.state);
    const beat: BiosBettingBeat = {
      kind: "ai-raise",
      round: 1,
      sequence: 6,
      player: "ai",
      action: "raise",
    };

    const projected = projectBiosBettingBeatLedger(ledger, beat, "call");

    expect(projected.players.ai.chips).toEqual([
      expect.objectContaining({ kind: "ante", amount: 1 }),
      expect.objectContaining({ kind: "call", amount: 1, status: "latest" }),
    ]);
    expect(projected.players.ai.chips.some((chip) => chip.kind === "raise")).toBe(false);
    expect(result.after.players.ai.invested).toBe(4);
  });

  it("結算節拍只暫時標示最後正式籌碼，之後可全部轉為完成", () => {
    const record = bettingRecord();
    record.apply({ type: "betting-action", player: "human", action: "bet", amount: 1 });
    const result = record.apply({ type: "betting-action", player: "ai", action: "call" });
    const ledger = projectBiosBettingLedger(record.events, record.state, 1);
    const beat = classifyBiosBettingBeat(result.event, result.before, result.after, 6)!;

    const projected = projectBiosBettingBeatLedger(ledger, beat, "settlement");

    expect(projected.players.ai.chips).toEqual([
      expect.objectContaining({ kind: "ante", status: "completed" }),
      expect.objectContaining({ kind: "call", amount: 1, status: "latest" }),
    ]);
    expect(projected.players.human.chips).toEqual([
      expect.objectContaining({ kind: "ante", status: "completed" }),
      expect.objectContaining({ kind: "bet", amount: 1, status: "completed" }),
    ]);
  });

  it("棄牌結算不新增籌碼，仍保留先前加注作為最後可見步驟", () => {
    const record = bettingRecord();
    record.apply({ type: "betting-action", player: "human", action: "bet", amount: 1 });
    record.apply({ type: "betting-action", player: "ai", action: "raise", amount: 1 });
    const result = record.apply({ type: "betting-action", player: "human", action: "fold" });
    const ledger = projectBiosBettingLedger(record.events, record.state, 1);
    const beat = classifyBiosBettingBeat(result.event, result.before, result.after, 8)!;

    expect(beat).toMatchObject({ kind: "settlement", action: "fold" });
    const projected = projectBiosBettingBeatLedger(ledger, beat, "settlement");
    expect(projected.players.ai.chips).toEqual([
      expect.objectContaining({ kind: "ante", status: "completed" }),
      expect.objectContaining({ kind: "call", status: "completed" }),
      expect.objectContaining({ kind: "raise", amount: 1, status: "latest" }),
    ]);
  });
});
