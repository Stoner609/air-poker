import { describe, expect, it } from "vitest";
import type { BiosDisplayChip } from "./bios-betting-preview";
import { projectCollapsedBiosChips } from "./bios-chip-rail";

function chip(
  id: string,
  kind: BiosDisplayChip["kind"],
  amount: number,
  status: BiosDisplayChip["status"] = "completed",
  preview?: BiosDisplayChip["preview"],
): BiosDisplayChip {
  return { id, player: "human", kind, amount, status, sequence: Number(id), preview };
}

describe("BIOS 籌碼軌收合投影", () => {
  it("超過兩行時收合較早灰色行動，保留參加費、最新與待確認籌碼", () => {
    const chips = [
      chip("0", "ante", 1, "completed"),
      chip("1", "bet", 1),
      chip("2", "call", 1),
      chip("3", "raise", 1),
      chip("4", "call", 1),
      chip("5", "raise", 1),
      chip("6", "call", 1, "completed", "pending"),
      chip("7", "raise", 2, "completed", "pending-latest"),
    ];

    const projection = projectCollapsedBiosChips(chips, 6);

    expect(projection.visible.map((item) => item.id)).toEqual(["0", "4", "5", "6", "7"]);
    expect(projection.collapsed.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(projection.collapsedAmount).toBe(3);
  });

  it("未超過收合上限時保留完整籌碼且不建立摘要", () => {
    const chips = [chip("0", "ante", 1), chip("1", "bet", 2), chip("2", "call", 2)];

    expect(projectCollapsedBiosChips(chips, 6)).toEqual({
      visible: chips,
      collapsed: [],
      collapsedAmount: 0,
    });
  });
});
