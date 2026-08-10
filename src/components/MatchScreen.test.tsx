import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BiosChipRail, StatusPanel } from "./MatchScreen";
import type { BiosDisplayChip } from "../services/bios-betting-preview";

const longLabel = "AI // NEMESIS // LONG PLAYER LABEL 0123456789";

const denseChips: BiosDisplayChip[] = [
  { id: "ante", player: "ai", kind: "ante", amount: 1, status: "completed", sequence: 1 },
  { id: "bet", player: "ai", kind: "bet", amount: 1, status: "completed", sequence: 2 },
  { id: "call-1", player: "ai", kind: "call", amount: 1, status: "completed", sequence: 3 },
  { id: "raise-1", player: "ai", kind: "raise", amount: 1, status: "completed", sequence: 4 },
  { id: "call-2", player: "ai", kind: "call", amount: 1, status: "completed", sequence: 5 },
  { id: "raise-2", player: "ai", kind: "raise", amount: 1, status: "latest", sequence: 6 },
  { id: "call-3", player: "ai", kind: "call", amount: 1, status: "completed", sequence: 7 },
];

describe("StatusPanel", () => {
  it("少量籌碼不會被固定三欄推離面板中央", () => {
    const chip: BiosDisplayChip = {
      id: "ante-only",
      player: "human",
      kind: "ante",
      amount: 1,
      status: "latest",
      sequence: 1,
    };

    render(
      <>
        <BiosChipRail label="YOU" side="left" chips={[chip]} />
        <BiosChipRail label="AI" side="right" chips={[{ ...chip, id: "ai-ante", player: "ai" }]} />
      </>,
    );

    const leftRail = screen.getByRole("list", { name: "YOU 當局 BIOS 下注籌碼" });
    const rightRail = screen.getByRole("list", { name: "AI 當局 BIOS 下注籌碼" });
    expect(leftRail).not.toHaveClass("grid");
    expect(leftRail).toHaveClass("flex", "flex-wrap", "justify-end");
    expect(rightRail).not.toHaveClass("grid");
    expect(rightRail).toHaveClass("flex", "flex-wrap", "justify-start");
  });

  it("長玩家名稱仍可換行，兩行籌碼軌與五局歷史保持可讀", () => {
    render(
      <StatusPanel
        label={longLabel}
        side="right"
        bios={22}
        invested={12}
        chips={denseChips}
        active
        hostile
        history={Array.from({ length: 5 }, (_, index) => ({
          round: index + 1,
          invested: index + 2,
        }))}
      />,
    );

    const panel = screen.getByText(longLabel).closest("[data-panel-side]");
    expect(panel).toHaveClass("min-w-0");
    expect(screen.getByText(longLabel)).toHaveClass("break-words");

    const rail = screen.getByRole("list", { name: `${longLabel} 當局 BIOS 下注籌碼` });
    expect(rail).toHaveAttribute("data-rail-layout", "two-rows");
    expect(rail).toHaveClass("flex", "flex-wrap", "justify-start");
    expect(within(rail).getAllByRole("listitem")).toHaveLength(6);
    expect(within(rail).getByRole("button", { name: /較早投入/ })).toBeVisible();

    const history = screen.getByLabelText(`${longLabel} 歷史 BIOS 投入`);
    expect(within(history).getAllByRole("listitem")).toHaveLength(5);
  });
});
