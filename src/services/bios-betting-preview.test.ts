import { describe, expect, it } from "vitest";
import { projectBiosBettingLedger } from "./bios-betting-ledger";
import { biosPreviewContribution, projectBiosPreviewChips } from "./bios-betting-preview";
import { createMatch } from "../domain/game";
import { NUMBER_PACKS } from "../content/number-packs";
import type { RecordedEvent } from "./match-repository";

function initialLedger() {
  const initial = createMatch({ seed: 42, numberPack: NUMBER_PACKS[0] });
  const events: RecordedEvent[] = [
    { sequence: 0, at: 0, event: { type: "match-created" }, state: initial },
  ];
  return projectBiosBettingLedger(events, initial);
}

describe("BIOS 下注預覽投影", () => {
  it("將跟注預覽標記為青藍色最新待確認，且不改變正式投入", () => {
    const ledger = initialLedger();
    const preview = { stage: "call" as const, callAmount: 2 };

    const chips = projectBiosPreviewChips("human", ledger.players.human, preview);

    expect(biosPreviewContribution(preview)).toBe(2);
    expect(ledger.players.human.invested).toBe(1);
    expect(chips).toEqual([
      expect.objectContaining({ kind: "ante", amount: 1, status: "neutral" }),
      expect.objectContaining({ kind: "call", amount: 2, preview: "pending-latest" }),
    ]);
  });

  it("將加注預覽拆成灰色待確認跟注與琥珀色最新待確認加注", () => {
    const ledger = initialLedger();
    const preview = { stage: "raise" as const, callAmount: 2, raiseAmount: 3 };

    const chips = projectBiosPreviewChips("human", ledger.players.human, preview);

    expect(biosPreviewContribution(preview)).toBe(5);
    expect(chips.slice(-2)).toEqual([
      expect.objectContaining({ kind: "call", amount: 2, preview: "pending" }),
      expect.objectContaining({ kind: "raise", amount: 3, preview: "pending-latest" }),
    ]);
  });

  it("將首次下注預覽維持為單顆待確認下注籌碼", () => {
    const ledger = initialLedger();
    const preview = { stage: "bet" as const, amount: 4 };

    const chips = projectBiosPreviewChips("human", ledger.players.human, preview);

    expect(biosPreviewContribution(preview)).toBe(4);
    expect(chips.at(-1)).toEqual(
      expect.objectContaining({ kind: "bet", amount: 4, preview: "pending-latest" }),
    );
  });
});
