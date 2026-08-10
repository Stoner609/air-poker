import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMatch, transition, type GameEvent } from "./domain/game";
import type { RecordedEvent } from "./services/match-repository";
import { App } from "./App";

const bettingPack = {
  id: "preview-test-pack",
  playerTargets: [22, 31, 36, 39, 47],
  aiTargets: [18, 25, 34, 44, 52],
};

function saveBettingMatch({
  outstanding = true,
  noRaise = false,
  valid = false,
}: { outstanding?: boolean; noRaise?: boolean; valid?: boolean } = {}) {
  const initial = createMatch({ seed: 42, numberPack: bettingPack });
  let state = initial;
  const events: RecordedEvent[] = [
    { sequence: 0, at: 0, event: { type: "match-created" }, state: initial },
  ];
  const apply = (event: GameEvent) => {
    state = transition(state, event).state;
    events.push({ sequence: events.length, at: events.length, event });
  };

  apply({ type: "target-selected", player: "human", target: 31 });
  apply({ type: "target-selected", player: "ai", target: 18 });
  apply({
    type: "hand-locked",
    player: "human",
    cardIds: valid ? ["SA", "H2", "D3", "CQ", "SK"] : ["SA", "H2", "D3", "C7", "S9"],
  });
  apply({
    type: "hand-locked",
    player: "ai",
    cardIds: valid ? ["S3", "H4", "D5", "CA", "S5"] : ["S3", "H4", "D5", "C6", "S7"],
  });
  if (outstanding) {
    apply({ type: "betting-action", player: "ai", action: "bet", amount: 1 });
    if (noRaise) state.players.human.bios = 1;
  }
  else {
    state.pot = 8;
    state.players.human.bios = 20;
    state.players.ai.bios = 20;
    state.currentActor = "human";
  }

  localStorage.setItem(
    "air-poker:active-match:v1",
    JSON.stringify({
      version: 1,
      state,
      events,
      savedAt: 0,
      openingInspectionComplete: true,
      openingInspectionRemaining: 0,
      acknowledgedRounds: 0,
    }),
  );
}

function savedEvents() {
  return JSON.parse(localStorage.getItem("air-poker:active-match:v1") ?? "{}").events as RecordedEvent[];
}

function saveAiBettingMatch(seed: number) {
  const initial = createMatch({ seed, numberPack: bettingPack });
  let state = initial;
  const events: RecordedEvent[] = [
    { sequence: 0, at: 0, event: { type: "match-created" }, state: initial },
  ];
  const apply = (event: GameEvent) => {
    state = transition(state, event).state;
    events.push({ sequence: events.length, at: events.length, event });
  };

  apply({ type: "target-selected", player: "human", target: 22 });
  apply({ type: "target-selected", player: "ai", target: 25 });
  apply({ type: "hand-locked", player: "human", cardIds: ["SA", "H2", "D3", "C7", "S9"] });
  apply({ type: "hand-locked", player: "ai", cardIds: ["S3", "S4", "S5", "S6", "S7"] });
  apply({ type: "betting-action", player: "human", action: "bet", amount: 1 });

  localStorage.setItem(
    "air-poker:active-match:v1",
    JSON.stringify({
      version: 1,
      state,
      events,
      savedAt: 0,
      openingInspectionComplete: true,
      openingInspectionRemaining: 0,
      acknowledgedRounds: 0,
    }),
  );
}

function saveAiRaiseMatch() {
  saveAiBettingMatch(1);
}

function saveDenseChipMatch() {
  const initial = createMatch({ seed: 42, numberPack: bettingPack });
  let state = initial;
  const events: RecordedEvent[] = [
    { sequence: 0, at: 0, event: { type: "match-created" }, state: initial },
  ];
  const apply = (event: GameEvent) => {
    state = transition(state, event).state;
    events.push({ sequence: events.length, at: events.length, event });
  };

  apply({ type: "target-selected", player: "human", target: 22 });
  apply({ type: "target-selected", player: "ai", target: 25 });
  apply({ type: "hand-locked", player: "human", cardIds: ["SA", "H2", "D3", "C7", "S9"] });
  apply({ type: "hand-locked", player: "ai", cardIds: ["S3", "S4", "S5", "S6", "S7"] });
  apply({ type: "betting-action", player: "human", action: "bet", amount: 1 });
  apply({ type: "betting-action", player: "ai", action: "raise", amount: 1 });
  apply({ type: "betting-action", player: "human", action: "raise", amount: 1 });
  apply({ type: "betting-action", player: "ai", action: "raise", amount: 1 });
  apply({ type: "betting-action", player: "human", action: "raise", amount: 1 });
  apply({ type: "betting-action", player: "ai", action: "raise", amount: 1 });

  localStorage.setItem(
    "air-poker:active-match:v1",
    JSON.stringify({
      version: 1,
      state,
      events,
      savedAt: 0,
      openingInspectionComplete: true,
      openingInspectionRemaining: 0,
      acknowledgedRounds: 0,
    }),
  );
}

describe("Air Poker 應用程式", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
  });

  it("從主選單提供新對局、教學、重播與設定入口", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "AIR POKER" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新對局" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "教學" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重播／匯入紀錄" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "設定" })).toBeInTheDocument();
  });

  it("開始新對局後顯示五張私密目標數字牌", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "新對局" }));

    expect(screen.getByRole("heading", { name: "開場檢視" })).toBeInTheDocument();
    expect(screen.getAllByText(/TARGET [1-5]/)).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "開始第一局" }));

    expect(screen.getByRole("heading", { name: "選擇本局數字" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /選擇目標數字/ })).toHaveLength(5);
    expect(screen.getAllByText("本局投入", { exact: true })).toHaveLength(2);
    expect(screen.getByRole("list", { name: "YOU 當局 BIOS 下注籌碼" })).toHaveTextContent("底 1");
    expect(screen.getByRole("list", { name: "AI // NEMESIS 當局 BIOS 下注籌碼" })).toHaveTextContent("底 1");
  });

  it("選定數字並等待 AI 後，顯示完整 52 張牌狀態表", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "新對局" }));
    await user.click(screen.getByRole("button", { name: "開始第一局" }));
    await user.click(screen.getAllByRole("button", { name: /選擇目標數字/ })[0]);

    expect(
      await screen.findByRole("heading", { name: "構築五張牌" }, { timeout: 2_000 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("gridcell")).toHaveLength(52);
  });

  it("跟注預覽可取消、進入加注再返回，且不寫入正式事件", async () => {
    const user = userEvent.setup();
    saveBettingMatch();
    const before = savedEvents();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "繼續對局" }));

    await user.click(screen.getByRole("button", { name: "跟注 1" }));
    expect(screen.getByRole("listitem", { name: /YOU 跟 1 BIOS，最新，待確認/ })).toHaveClass("border-dashed");
    expect(screen.getByText(/\+1 待確認/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消預覽" }));
    expect(screen.queryByRole("listitem", { name: /待確認/ })).not.toBeInTheDocument();
    expect(savedEvents()).toEqual(before);

    await user.click(screen.getByRole("button", { name: "跟注 1" }));
    await user.click(screen.getByRole("button", { name: "繼續加注" }));
    expect(screen.getByRole("listitem", { name: /YOU 跟 1 BIOS，待確認/ })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /YOU 加 1 BIOS，最新，待確認/ })).toHaveClass("border-dashed");
    await user.click(screen.getByRole("button", { name: "返回跟注預覽" }));
    expect(screen.getByRole("listitem", { name: /YOU 跟 1 BIOS，最新，待確認/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消預覽" }));
    expect(savedEvents()).toEqual(before);
  });

  it("只跟注與確認加注各只送出一筆既有正式下注事件", async () => {
    const user = userEvent.setup();
    saveBettingMatch();
    const firstRender = render(<App />);
    await user.click(screen.getByRole("button", { name: "繼續對局" }));
    await user.click(screen.getByRole("button", { name: "跟注 1" }));
    await user.click(screen.getByRole("button", { name: "只跟注 1" }));
    expect(savedEvents().at(-1)?.event).toEqual({ type: "betting-action", player: "human", action: "call" });

    firstRender.unmount();
    localStorage.clear();
    saveBettingMatch();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "繼續對局" }));
    await user.click(screen.getByRole("button", { name: "跟注 1" }));
    await user.click(screen.getByRole("button", { name: "繼續加注" }));
    await user.click(screen.getByRole("button", { name: "確認加注 1" }));
    expect(savedEvents().at(-1)?.event).toEqual({ type: "betting-action", player: "human", action: "raise", amount: 1 });
  });

  it("調整首次下注金額才會建立待確認下注預覽", async () => {
    const user = userEvent.setup();
    saveBettingMatch({ outstanding: false });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "繼續對局" }));

    expect(screen.queryByRole("listitem", { name: /待確認/ })).not.toBeInTheDocument();
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "2" } });
    expect(screen.getByRole("listitem", { name: /YOU 押 2 BIOS，最新，待確認/ })).toHaveClass("border-dashed");
    expect(screen.getByText(/\+2 待確認/)).toBeInTheDocument();
    expect(savedEvents().at(-1)?.event).toEqual({ type: "hand-locked", player: "ai", cardIds: ["S3", "H4", "D5", "C6", "S7"] });
  });

  it("無法再加注時，跟注直接送出而不增加確認步驟", async () => {
    const user = userEvent.setup();
    saveBettingMatch({ noRaise: true });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "繼續對局" }));

    expect(screen.getByRole("button", { name: "跟注 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "預覽跟注 1" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "跟注 1" }));
    expect(savedEvents().at(-1)?.event).toEqual({ type: "betting-action", player: "human", action: "call" });
  });

  it("重新載入對局只恢復正式籌碼，不恢復待確認預覽", async () => {
    const user = userEvent.setup();
    saveBettingMatch();
    const firstRender = render(<App />);
    await user.click(screen.getByRole("button", { name: "繼續對局" }));
    await user.click(screen.getByRole("button", { name: "跟注 1" }));
    expect(screen.getByRole("listitem", { name: /待確認/ })).toBeInTheDocument();

    firstRender.unmount();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "繼續對局" }));
    expect(screen.queryByRole("listitem", { name: /待確認/ })).not.toBeInTheDocument();
    expect(savedEvents().at(-1)?.event).toEqual({ type: "betting-action", player: "ai", action: "bet", amount: 1 });
  });

  it("下注逾時會清除預覽並沿用既有棄注規則", async () => {
    const user = userEvent.setup();
    saveBettingMatch();
    const record = JSON.parse(localStorage.getItem("air-poker:active-match:v1") ?? "{}");
    record.timerKey = "1:betting:active:0:human:31:locked";
    record.timerRemaining = 1;
    localStorage.setItem("air-poker:active-match:v1", JSON.stringify(record));
    render(<App />);
    await user.click(screen.getByRole("button", { name: "繼續對局" }));
    await user.click(screen.getByRole("button", { name: "跟注 1" }));

    await waitFor(
      () => expect(savedEvents().at(-1)?.event).toEqual({ type: "betting-action", player: "human", action: "fold" }),
      { timeout: 2_500 },
    );
    expect(screen.queryByRole("listitem", { name: /待確認/ })).not.toBeInTheDocument();
  });

  it("AI 加注先顯示跟注節拍，再顯示正式加注且不延後正式事件", () => {
    vi.useFakeTimers();
    saveAiRaiseMatch();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "繼續對局" }));

    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByTestId("ai-raise-call-beat")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /AI \/\/ NEMESIS 跟 1 BIOS，最新/ })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: /AI \/\/ NEMESIS 加/ })).not.toBeInTheDocument();
    expect(savedEvents().at(-1)?.event).toEqual({ type: "betting-action", player: "ai", action: "raise", amount: 1 });

    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByTestId("ai-raise-call-beat")).not.toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /AI \/\/ NEMESIS 加 1 BIOS，最新/ })).toBeInTheDocument();
  });

  it("結束下注後保留最後行動約半秒，再將揭露籌碼全部轉灰", () => {
    vi.useFakeTimers();
    saveBettingMatch({ valid: true });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "繼續對局" }));
    fireEvent.click(screen.getByRole("button", { name: "跟注 1" }));
    fireEvent.click(screen.getByRole("button", { name: "只跟注 1" }));

    expect(screen.getByText("最後行動 · 即將揭露")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "揭露中…" })).toBeDisabled();
    expect(screen.getByRole("listitem", { name: /YOU 跟 1 BIOS，最新/ })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(499));
    expect(screen.getByRole("listitem", { name: /YOU 跟 1 BIOS，最新/ })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("已完成 · 灰色表示已結算")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /YOU 跟 1 BIOS，已完成/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "進入第 2 局" })).toBeEnabled();
  });

  it("AI 單純跟注時，跟注籌碼在揭露前保持最新可見", () => {
    vi.useFakeTimers();
    saveAiBettingMatch(42);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "繼續對局" }));

    act(() => vi.advanceTimersByTime(1_100));
    expect(screen.getByText("最後行動 · 即將揭露")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /AI \/\/ NEMESIS 跟 1 BIOS，最新/ })).toBeInTheDocument();
    expect(savedEvents().at(-1)?.event).toEqual({ type: "betting-action", player: "ai", action: "call" });

    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("listitem", { name: /AI \/\/ NEMESIS 跟 1 BIOS，已完成/ })).toBeInTheDocument();
  });

  it("偏好減少動態效果時直接呈現完成揭露，不等待節拍", () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });

    try {
      saveBettingMatch({ valid: true });
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: "繼續對局" }));
      fireEvent.click(screen.getByRole("button", { name: "跟注 1" }));
      fireEvent.click(screen.getByRole("button", { name: "只跟注 1" }));

      expect(screen.getByText("已完成 · 灰色表示已結算")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "進入第 2 局" })).toBeEnabled();
      expect(screen.queryByText("最後行動 · 即將揭露")).not.toBeInTheDocument();
    } finally {
      if (originalMatchMedia) {
        Object.defineProperty(window, "matchMedia", {
          configurable: true,
          value: originalMatchMedia,
        });
      } else {
        Object.defineProperty(window, "matchMedia", {
          configurable: true,
          value: undefined,
        });
      }
    }
  });

  it("雙方籌碼軌鏡像靠近中央，較早投入可用鍵盤展開與收合", async () => {
    const user = userEvent.setup();
    saveDenseChipMatch();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "繼續對局" }));

    const leftPanel = document.querySelector('[data-panel-side="left"]') as HTMLElement;
    const rightPanel = document.querySelector('[data-panel-side="right"]') as HTMLElement;
    expect(leftPanel).toBeInTheDocument();
    expect(rightPanel).toBeInTheDocument();
    expect(within(leftPanel).getByRole("list", { name: "YOU 當局 BIOS 下注籌碼" })).toHaveClass("justify-end");
    expect(within(rightPanel).getByRole("list", { name: "AI // NEMESIS 當局 BIOS 下注籌碼" })).toHaveClass("justify-start");

    const aiRail = within(rightPanel).getByRole("list", { name: "AI // NEMESIS 當局 BIOS 下注籌碼" });
    const summary = within(aiRail).getByRole("button", { name: /較早投入/ });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(summary).toHaveClass("focus-visible:outline-2");
    expect(within(aiRail).getAllByRole("listitem")).toHaveLength(6);

    summary.focus();
    await user.keyboard("{Enter}");
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(within(aiRail).getAllByRole("listitem")).toHaveLength(8);

    await user.keyboard(" ");
    expect(summary).toHaveAttribute("aria-expanded", "false");
  });

  it.each([
    ["教學", "訓練協定"],
    ["重播／匯入紀錄", "對局檔案庫"],
    ["設定", "系統設定"],
  ])("可從主選單開啟%s", async (buttonName, headingName) => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: buttonName }));
    expect(screen.getByRole("heading", { name: headingName })).toBeInTheDocument();
  });
});
