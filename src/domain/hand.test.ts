import { describe, expect, it } from "vitest";
import { compareHands, createDeck, evaluateSubmission } from "./hand";

describe("正式提交", () => {
  it("辨識目標 39 的四條 9 為有效提交", () => {
    const deck = createDeck();
    const cards = ["S9", "H9", "D9", "C9", "S3"];

    const result = evaluateSubmission({
      cardIds: cards,
      target: 39,
      availableCardIds: deck.map((card) => card.id),
    });

    expect(result).toMatchObject({
      valid: true,
      total: 39,
      hand: { category: "four-of-a-kind", label: "四條" },
    });
  });

  it("A 固定以 1 計算總和，但皇家同花順以 A 高比較", () => {
    const deck = createDeck();

    const result = evaluateSubmission({
      cardIds: ["S10", "SJ", "SQ", "SK", "SA"],
      target: 47,
      availableCardIds: deck.map((card) => card.id),
    });

    expect(result).toMatchObject({
      valid: true,
      total: 47,
      hand: { category: "straight-flush", label: "同花順", strength: [8, 14] },
    });
  });

  it.each([
    [["SK", "HK", "DK", "SQ", "HQ"], 63, "full-house", "葫蘆"],
    [["S2", "S5", "S8", "SJ", "SK"], 39, "flush", "同花"],
    [["SA", "H2", "D3", "C4", "S5"], 15, "straight", "順子"],
    [["S7", "H7", "D7", "C2", "S3"], 26, "three-of-a-kind", "三條"],
    [["S8", "H8", "D4", "C4", "SA"], 25, "two-pair", "兩對"],
    [["SJ", "HJ", "D2", "C4", "S6"], 34, "pair", "一對"],
    [["SK", "HJ", "D8", "C4", "SA"], 37, "high-card", "高牌"],
  ] as const)("辨識 %s 為 %s", (cardIds, target, category, label) => {
    const result = evaluateSubmission({
      cardIds: [...cardIds],
      target,
      availableCardIds: createDeck().map((card) => card.id),
    });

    expect(result).toMatchObject({ valid: true, hand: { category, label } });
  });

  it("依牌型與關鍵牌逐項比較，不以花色破除平手", () => {
    const availableCardIds = createDeck().map((card) => card.id);
    const straightFlush = evaluateSubmission({
      cardIds: ["S3", "S4", "S5", "S6", "S7"],
      target: 25,
      availableCardIds,
    });
    const fourOfAKind = evaluateSubmission({
      cardIds: ["S9", "H9", "D9", "C9", "S3"],
      target: 39,
      availableCardIds,
    });

    if (!straightFlush.valid || !fourOfAKind.valid) throw new Error("fixture invalid");
    expect(compareHands(straightFlush.hand, fourOfAKind.hand)).toBeGreaterThan(0);
    expect(compareHands(straightFlush.hand, straightFlush.hand)).toBe(0);
  });

  it("同牌型比較時 A 高於 K", () => {
    const availableCardIds = createDeck().map((card) => card.id);
    const aces = evaluateSubmission({
      cardIds: ["SA", "HA", "D2", "C3", "S4"],
      target: 11,
      availableCardIds,
    });
    const kings = evaluateSubmission({
      cardIds: ["SK", "HK", "DA", "C2", "S3"],
      target: 32,
      availableCardIds,
    });

    if (!aces.valid || !kings.valid) throw new Error("fixture invalid");
    expect(compareHands(aces.hand, kings.hand)).toBeGreaterThan(0);
  });
});
