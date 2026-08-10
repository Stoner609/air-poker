import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getBetLimits,
  type GameEvent,
  type GameState,
  type RoundRecord,
} from "../domain/game";
import { compareHands, createDeck, evaluateSubmission } from "../domain/hand";
import { timeoutEventFor } from "../domain/timeout";
import {
  projectBiosBettingLedger,
  projectCompletedBiosLedgers,
} from "../services/bios-betting-ledger";
import {
  classifyBiosBettingBeat,
  projectBiosBettingBeatLedger,
  type BiosBettingBeat,
} from "../services/bios-betting-beat";
import {
  biosPreviewContribution,
  projectBiosPreviewChips,
  type BiosBettingPreview,
  type BiosDisplayChip,
} from "../services/bios-betting-preview";
import { projectCollapsedBiosChips } from "../services/bios-chip-rail";
import type { RecordedEvent } from "../services/match-repository";
import { projectReplayStates } from "../services/replay";
import { solveInBackground } from "../services/solver-service";

const suitNames = { S: "黑桃", H: "紅心", D: "方塊", C: "梅花" } as const;
const suitGlyphs = { S: "♠", H: "♥", D: "♦", C: "♣" } as const;
const phaseNames = {
  "number-selection": "選擇數字",
  construction: "候選組牌",
  betting: "心理下注",
  correction: "修正選牌",
  reveal: "結算",
  complete: "對局完成",
} as const;

const actionButton =
  "border border-emerald-300/30 bg-emerald-300/[0.07] px-4 py-2 font-mono text-xs tracking-[0.12em] text-emerald-50 transition hover:border-emerald-200 hover:bg-emerald-300/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-25";
const AI_RAISE_CALL_BEAT_MS = 300;
const SETTLEMENT_BEAT_MS = 500;
const COLLAPSED_BIOS_CHIP_LIMIT = 6;

type ActiveBettingBeat = {
  beat: BiosBettingBeat;
  stage: "call" | "settlement";
};

export function MatchScreen({
  state,
  events,
  onEvent,
  onExit,
  openingInspectionComplete,
  openingInspectionRemaining,
  onOpeningInspectionChange,
  acknowledgedRounds,
  onAcknowledgeReveal,
  onSystemEvent,
  onExport,
  savedTimer,
  onTimerChange,
}: {
  state: GameState;
  events: RecordedEvent[];
  onEvent: (event: GameEvent) => void;
  onExit: () => void;
  openingInspectionComplete: boolean;
  openingInspectionRemaining: number;
  onOpeningInspectionChange: (remaining: number, complete?: boolean) => void;
  acknowledgedRounds: number;
  onAcknowledgeReveal: () => void;
  onSystemEvent: (event: RecordedEvent["event"]) => void;
  onExport: () => void;
  savedTimer?: { key?: string; remaining?: number | null };
  onTimerChange?: (key: string, remaining: number | null) => void;
}) {
  const human = state.players.human;
  const ai = state.players.ai;
  const biosLedger = useMemo(() => projectBiosBettingLedger(events, state), [events, state]);
  const completedBiosLedgers = useMemo(
    () => projectCompletedBiosLedgers(events, state),
    [events, state],
  );
  const deck = useMemo(() => createDeck(), []);
  const deckById = useMemo(() => new Map(deck.map((card) => [card.id, card])), [deck]);
  const available = useMemo(() => new Set(state.availableCardIds), [state.availableCardIds]);
  const [wager, setWager] = useState(1);
  const [bettingPreview, setBettingPreview] = useState<BiosBettingPreview | null>(null);
  const [bettingBeat, setBettingBeat] = useState<ActiveBettingBeat | null>(null);
  const [hideUsed, setHideUsed] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const draftHistory = useRef<{ key: string; items: string[][] }>({ key: "", items: [] });
  const handledBettingEventSequence = useRef(events.at(-1)?.sequence ?? -1);
  const reducedMotion = usePrefersReducedMotion();
  const draftContextKey = `${state.round}:${state.phase}:${state.correctionAttempt}`;
  if (draftHistory.current.key !== draftContextKey) {
    draftHistory.current = { key: draftContextKey, items: [] };
  }
  const pendingReveal = state.history[acknowledgedRounds];
  const paused = !openingInspectionComplete || Boolean(pendingReveal);
  const clearBettingPreview = useCallback(() => setBettingPreview(null), []);
  const submitBettingEvent = useCallback(
    (event: GameEvent) => {
      setBettingPreview(null);
      onEvent(event);
    },
    [onEvent],
  );
  const { key: timerKey, remaining: timerRemaining } = useMatchTimer(
    state,
    onEvent,
    savedTimer,
    onTimerChange,
    paused,
    () => {
      clearBettingPreview();
      onSystemEvent({ type: "phase-timeout", phase: state.phase });
    },
  );

  useLayoutEffect(() => {
    const latest = events.at(-1);
    if (!latest || latest.sequence <= handledBettingEventSequence.current) return;
    handledBettingEventSequence.current = latest.sequence;

    const replayStates = projectReplayStates(events, state);
    const beat = classifyBiosBettingBeat(
      latest.event,
      replayStates.at(-2),
      state,
      latest.sequence,
    );
    if (!beat || reducedMotion) {
      setBettingBeat(null);
      return;
    }

    const stage = beat.kind === "ai-raise" ? "call" : "settlement";
    setBettingBeat({ beat, stage });
    const duration = beat.kind === "ai-raise" ? AI_RAISE_CALL_BEAT_MS : SETTLEMENT_BEAT_MS;
    const timeout = window.setTimeout(() => {
      setBettingBeat((current) =>
        current?.beat.sequence === beat.sequence ? null : current,
      );
    }, duration);
    return () => window.clearTimeout(timeout);
  }, [events, reducedMotion, state]);

  useEffect(() => {
    if (reducedMotion) setBettingBeat(null);
  }, [reducedMotion]);
  const [hint, setHint] = useState<string[] | undefined>();

  const selectedTotal = human.draft.reduce(
    (total, id) => total + (deckById.get(id)?.value ?? 0),
    0,
  );
  const preview =
    human.draft.length === 5
      ? evaluateSubmission({
          cardIds: human.draft,
          target: selectedTotal,
          availableCardIds: deck.map((card) => card.id),
        })
      : undefined;
  const liveValidation =
    human.selectedTarget !== undefined
      ? evaluateSubmission({
          cardIds: human.draft,
          target: human.selectedTarget,
          availableCardIds: state.availableCardIds,
        })
      : undefined;
  const limits = getBetLimits(state, "human");
  const maxWager = limits.outstanding > 0 ? limits.raiseMax : limits.betMax;
  const activeBettingPreview =
    state.phase === "betting" &&
    state.currentActor === "human" &&
    bettingPreview &&
    isBettingPreviewValid(limits, bettingPreview)
      ? bettingPreview
      : null;
  const activeAiRaiseBeat =
    state.phase === "betting" && bettingBeat?.beat.kind === "ai-raise" ? bettingBeat : null;
  const activeSettlementBeat =
    pendingReveal &&
    bettingBeat?.beat.kind === "settlement" &&
    bettingBeat.beat.round === pendingReveal.round
      ? bettingBeat.beat
      : null;
  const humanDisplayChips = useMemo(
    () => projectBiosPreviewChips("human", biosLedger.players.human, activeBettingPreview),
    [activeBettingPreview, biosLedger.players.human],
  );
  const aiDisplayChips = useMemo(
    () =>
      activeAiRaiseBeat
        ? projectBiosBettingBeatLedger(
            biosLedger,
            activeAiRaiseBeat.beat,
            activeAiRaiseBeat.stage,
          ).players.ai.chips
        : biosLedger.players.ai.chips,
    [activeAiRaiseBeat, biosLedger],
  );
  const humanPendingInvested = activeBettingPreview
    ? biosPreviewContribution(activeBettingPreview)
    : 0;

  useEffect(() => setWager(Math.max(1, Math.min(maxWager || 1, wager))), [maxWager]);

  useEffect(() => {
    setBettingPreview(null);
  }, [
    state.round,
    state.phase,
    state.currentActor,
    state.players.human.invested,
    state.players.ai.invested,
  ]);

  const continueAfterReveal = useCallback(() => {
    setBettingBeat(null);
    onAcknowledgeReveal();
  }, [onAcknowledgeReveal]);

  useEffect(() => {
    const remainingTargets = human.targets.filter((target) => !human.usedTargets.includes(target));
    if (
      openingInspectionComplete &&
      !pendingReveal &&
      state.phase === "number-selection" &&
      human.selectedTarget === undefined &&
      remainingTargets.length === 1
    ) {
      queueMicrotask(() =>
        onEvent({ type: "target-selected", player: "human", target: remainingTargets[0] }),
      );
    }
  }, [human.selectedTarget, human.targets, human.usedTargets, onEvent, openingInspectionComplete, pendingReveal, state.phase]);

  useEffect(() => {
    const eligible =
      state.settings.assisted &&
      !paused &&
      (state.phase === "construction" || state.phase === "correction") &&
      timerRemaining !== null &&
      timerRemaining <= 20 &&
      human.selectedTarget !== undefined &&
      !human.lockedCards;
    if (!eligible) {
      setHint(undefined);
      return;
    }
    let cancelled = false;
    void solveInBackground({
      target: human.selectedTarget!,
      availableCardIds: state.availableCardIds,
      limit: 1,
    }).then((solutions) => {
      if (!cancelled) setHint(solutions[0]?.cardIds);
    });
    return () => {
      cancelled = true;
    };
  }, [human.lockedCards, human.selectedTarget, paused, state.availableCardIds, state.phase, state.settings.assisted, timerRemaining]);

  if (!openingInspectionComplete) {
    return (
      <OpeningInspection
        state={state}
        initialRemaining={openingInspectionRemaining}
        onChange={onOpeningInspectionChange}
        onExit={onExit}
      />
    );
  }

  if (pendingReveal) {
    return (
      <RoundReveal
        round={pendingReveal}
        state={state}
        events={events}
        settlementBeat={activeSettlementBeat}
        onContinue={continueAfterReveal}
      />
    );
  }

  if (state.phase === "complete") {
    return <ResultsScreen state={state} events={events} onExit={onExit} onExport={onExport} />;
  }

  const toggleCard = (id: string) => {
    if (human.lockedCards) return;
    const cardIds = human.draft.includes(id)
      ? human.draft.filter((cardId) => cardId !== id)
      : human.draft.length < 5
        ? [...human.draft, id]
        : human.draft;
    if (cardIds !== human.draft) draftHistory.current.items.push([...human.draft]);
    onEvent({ type: "draft-changed", player: "human", cardIds });
  };

  const replaceDraft = (cardIds: string[]) => {
    draftHistory.current.items.push([...human.draft]);
    onEvent({ type: "draft-changed", player: "human", cardIds });
  };

  const undoDraft = () => {
    const previous = draftHistory.current.items.pop();
    if (previous) onEvent({ type: "draft-changed", player: "human", cardIds: previous });
  };

  const lastRound = state.history.at(-1);

  return (
    <main className="min-h-dvh bg-[#06110d] p-4 text-emerald-50">
      <div className="mx-auto max-w-[1280px]">
        <header className="flex items-center justify-between border-b border-emerald-300/15 pb-3">
          <button
            className="font-mono text-xs tracking-[0.16em] text-emerald-200/60 hover:text-emerald-100"
            onClick={onExit}
          >
            ← 主選單
          </button>
          <div className="flex items-center gap-5 font-mono text-[11px] tracking-[0.18em]">
            <span className="text-emerald-100/35">ROUND {state.round} / 5</span>
            <span className="border border-emerald-300/25 px-3 py-1 text-emerald-200">
              {phaseNames[state.phase]}
            </span>
            <span
              className={`min-w-16 text-center ${
                timerRemaining !== null && timerRemaining <= 10 ? "text-rose-300" : "text-emerald-100/45"
              }`}
              aria-label={timerRemaining === null ? "無倒數" : `剩餘 ${timerRemaining} 秒`}
              data-timer-key={timerKey}
            >
              {timerRemaining === null ? "∞" : `${timerRemaining}s`}
            </span>
          </div>
          <p className="text-right font-mono text-xs text-amber-200">
            <span className="block">底池 {state.pot} BIOS</span>
            <span className="mt-1 block text-[9px] text-emerald-100/30">
              本局參加費 {state.round} · 下一局 {state.round < 5 ? state.round + 1 : "—"}
            </span>
          </p>
        </header>

        {state.settings.assisted && (
          <div className="mt-3 flex items-center justify-between border border-cyan-300/20 bg-cyan-300/[0.045] px-4 py-2 font-mono text-[10px] text-cyan-100/65">
            <span>FIRST MATCH ASSIST · 寬鬆倒數、已使用牌警告、最後 20 秒合法解提示</span>
            <span>LOCAL ONLY</span>
          </div>
        )}

        {state.round === 5 && Math.abs(human.bios - ai.bios) > 10 && (
          <div className="mt-3 border border-amber-200/30 bg-amber-200/[0.055] px-4 py-2 text-sm text-amber-100/75">
            安全區：{human.bios > ai.bios ? "你" : "AI"}在第四局後領先 11 BIOS 以上；第五局首次合法行動立即棄牌仍可保證獲勝。
          </div>
        )}

        {state.phase === "correction" && (
          <div className="mt-3 border border-rose-300/30 bg-rose-300/[0.055] px-4 py-3 text-sm text-rose-100/80">
            雙方提交都無效：目標數字、底池與牌張狀態不變。這是第 {state.correctionAttempt} 次修正選牌。
          </div>
        )}

        <section className="mt-3 grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
          <StatusPanel
            label="YOU"
            side="left"
            bios={human.bios}
            invested={biosLedger.players.human.invested}
            pendingInvested={humanPendingInvested}
            chips={humanDisplayChips}
            active={state.currentActor === "human"}
            history={completedBiosLedgers.map((ledger) => ({
              round: ledger.round,
              invested: ledger.players.human.invested,
            }))}
          />
          <div className="grid min-w-48 place-items-center border border-emerald-300/10 bg-black/20 px-5 text-center">
            <p className="font-mono text-[9px] tracking-[0.28em] text-emerald-200/35">PUBLIC TARGETS</p>
            <div className="mt-1 flex items-center justify-center gap-5 text-2xl font-black">
              <span>{human.selectedTarget ?? "—"}</span>
              <span className="text-xs text-emerald-100/25">VS</span>
              <span>{state.phase === "number-selection" ? "?" : (ai.selectedTarget ?? "—")}</span>
            </div>
            <p className="mt-1 font-mono text-[8px] tracking-[0.12em] text-emerald-100/30">
              剩餘 YOU {human.targets.length - human.usedTargets.length} · AI {ai.targets.length - ai.usedTargets.length}
              <span className="ml-2">AI 已用 [{ai.usedTargets.join(" · ") || "—"}]</span>
            </p>
          </div>
          <StatusPanel
            label="AI // NEMESIS"
            side="right"
            bios={ai.bios}
            invested={biosLedger.players.ai.invested}
            chips={aiDisplayChips}
            active={state.currentActor === "ai"}
            history={completedBiosLedgers.map((ledger) => ({
              round: ledger.round,
              invested: ledger.players.ai.invested,
            }))}
            hostile
          />
        </section>

        {state.phase === "number-selection" ? (
          <TargetSelection state={state} onEvent={onEvent} />
        ) : (
          <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_330px] gap-3">
            <section className="min-w-0 border border-emerald-300/15 bg-black/15 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="font-mono text-[9px] tracking-[0.25em] text-emerald-200/38">
                    SHARED CARD STATE
                  </p>
                  <h1 className="mt-1 text-xl font-bold">
                    {state.phase === "betting" ? "讀取牌張狀態" : "構築五張牌"}
                  </h1>
                </div>
                <div className="flex items-center gap-4 text-right font-mono text-[10px] text-emerald-100/40">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={hideUsed} onChange={(event) => setHideUsed(event.target.checked)} className="accent-emerald-300" />
                    只看可用牌
                  </label>
                  <button className="border border-emerald-300/20 px-2 py-1 hover:text-emerald-100" onClick={() => setShowReference((current) => !current)}>牌型速查</button>
                  <span><span className="block">可用 {state.availableCardIds.length} / 52</span><span className="block">已使用 {52 - state.availableCardIds.length}</span></span>
                </div>
              </div>

              {showReference && (
                <div className="mb-3 grid grid-cols-9 gap-1 border border-emerald-300/10 bg-black/20 p-2 text-center font-mono text-[9px] text-emerald-100/45">
                  {['同花順', '四條', '葫蘆', '同花', '順子', '三條', '兩對', '一對', '高牌'].map((label, index) => (
                    <span key={label} className="border-r border-emerald-300/10 last:border-0">{9 - index}. {label}</span>
                  ))}
                </div>
              )}

              <div
                className="grid grid-cols-[repeat(13,minmax(0,1fr))] gap-1"
                role="grid"
                aria-label="共用 52 張牌狀態表"
              >
                {deck.filter((card) => !hideUsed || available.has(card.id)).map((card) => {
                  const selected = human.draft.includes(card.id);
                  const used = !available.has(card.id);
                  const red = card.suit === "H" || card.suit === "D";
                  const editable =
                    (state.phase === "construction" || state.phase === "correction") &&
                    !human.lockedCards;
                  return (
                    <button
                      key={card.id}
                      role="gridcell"
                      aria-label={`${suitNames[card.suit]} ${card.rank}，${used ? "已使用" : "可用"}${selected ? "，已選擇" : ""}`}
                      aria-pressed={selected}
                      disabled={!editable}
                      onClick={() => toggleCard(card.id)}
                      className={`relative aspect-[0.72] min-w-0 border text-center transition focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-amber-300 ${
                        selected
                          ? "-translate-y-1 border-amber-200 bg-amber-200/15 shadow-[0_0_16px_rgba(253,230,138,0.16)]"
                          : used
                            ? "border-slate-500/10 bg-slate-950/75 opacity-35"
                            : "border-emerald-300/15 bg-emerald-950/45 hover:border-emerald-200/65 hover:bg-emerald-300/10"
                      } ${red ? "text-rose-300" : "text-emerald-50"}`}
                    >
                      <span className="block text-[11px] font-bold leading-none">{card.rank}</span>
                      <span className="mt-0.5 block text-[11px] leading-none" aria-hidden="true">
                        {suitGlyphs[card.suit]}
                      </span>
                      {used && <span className="absolute inset-x-0 bottom-0.5 text-[6px] text-slate-300">USED</span>}
                    </button>
                  );
                })}
              </div>
            </section>

            <aside className="min-w-0 space-y-3">
              <section className="border border-emerald-300/15 bg-emerald-950/25 p-4">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="font-mono text-[9px] tracking-[0.22em] text-emerald-200/35">TARGET</p>
                    <p className="text-4xl font-black text-white">{human.selectedTarget}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[9px] tracking-[0.22em] text-emerald-200/35">TOTAL</p>
                    <p
                      className={`text-2xl font-black ${
                        selectedTotal === human.selectedTarget ? "text-emerald-300" : "text-amber-200"
                      }`}
                    >
                      {selectedTotal}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-5 gap-1" aria-label="目前組牌槽">
                  {Array.from({ length: 5 }, (_, index) => {
                    const id = human.draft[index];
                    const card = id ? deckById.get(id) : undefined;
                    return (
                      <div
                        key={index}
                        className="grid aspect-[0.72] place-items-center border border-dashed border-emerald-300/20 bg-black/25 text-center"
                      >
                        {card ? (
                          <span className={card.suit === "H" || card.suit === "D" ? "text-rose-300" : "text-white"}>
                            <strong className="block text-sm">{card.rank}</strong>
                            <span aria-hidden="true">{suitGlyphs[card.suit]}</span>
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-emerald-100/15">{index + 1}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 min-h-10 border-l-2 border-emerald-300/20 pl-3 text-xs leading-5 text-emerald-100/55">
                  <p>{preview?.valid ? preview.hand.label : "尚未形成完整牌型"}</p>
                  {state.settings.assisted && human.draft.some((id) => !available.has(id)) && (
                    <p className="text-rose-300">包含已使用牌，正式提交將無效</p>
                  )}
                  {state.settings.assisted && liveValidation?.valid && (
                    <p className="text-emerald-300">有效提交</p>
                  )}
                  {state.settings.assisted && human.selectedTarget !== undefined && (
                    <p>距離目標 {human.selectedTarget - selectedTotal >= 0 ? "+" : ""}{human.selectedTarget - selectedTotal}</p>
                  )}
                </div>

                {hint && (
                  <div className="mt-3 border border-cyan-300/20 bg-cyan-300/[0.05] p-3 text-xs text-cyan-50/75">
                    <p className="font-mono text-[9px] tracking-[0.18em] text-cyan-200/50">LEGAL HINT · 不保證最佳</p>
                    <p className="mt-2 font-mono">{hint.join(" · ")}</p>
                  </div>
                )}

                {(state.phase === "construction" || state.phase === "correction") && (
                  <div className="mt-4 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        className={actionButton}
                        disabled={draftHistory.current.items.length === 0 || Boolean(human.lockedCards)}
                        onClick={undoDraft}
                      >
                        復原
                      </button>
                      <button
                        className={actionButton}
                        disabled={human.draft.length !== 5 || Boolean(human.lockedCards)}
                        onClick={() => onEvent({ type: "candidate-saved", player: "human" })}
                      >
                        保存候選
                      </button>
                      <button
                        className={actionButton}
                        disabled={human.draft.length === 0 || Boolean(human.lockedCards)}
                        onClick={() => replaceDraft([])}
                      >
                        清空
                      </button>
                    </div>
                    {human.savedCandidates.length > 0 && (
                      <div className="flex gap-2">
                        {human.savedCandidates.map((candidate, index) => (
                          <button
                            key={candidate.join(",")}
                            className="flex-1 border border-emerald-300/20 py-1 font-mono text-[10px] text-emerald-100/55"
                            onClick={() => {
                              draftHistory.current.items.push([...human.draft]);
                              onEvent({ type: "candidate-selected", player: "human", index });
                            }}
                          >
                            C{index + 1}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      className={`${actionButton} w-full border-amber-200/45 bg-amber-200/10 text-amber-100`}
                      disabled={Boolean(human.lockedCards)}
                      onClick={() =>
                        onEvent({ type: "hand-locked", player: "human", cardIds: human.draft })
                      }
                    >
                      {human.lockedCards ? "已鎖定，等待對手" : "鎖定預備提交"}
                    </button>
                  </div>
                )}
              </section>

              {state.phase === "betting" &&
                (activeAiRaiseBeat ? (
                  <BettingBeatNotice beat={activeAiRaiseBeat.beat} />
                ) : (
                  <BettingPanel
                    state={state}
                    wager={wager}
                    setWager={setWager}
                    preview={activeBettingPreview}
                    onPreviewChange={setBettingPreview}
                    onEvent={submitBettingEvent}
                  />
                ))}

              {lastRound && (
                <section className="border border-emerald-300/10 bg-black/20 p-3 text-xs text-emerald-100/50">
                  <p className="font-mono text-[9px] tracking-[0.2em] text-emerald-200/35">LAST RESULT</p>
                  <p className="mt-2">
                    第 {lastRound.round} 局 · {lastRound.winner === "human" ? "你獲勝" : lastRound.winner === "ai" ? "AI 獲勝" : "平手"}
                  </p>
                  <p className="mt-1">{lastRound.conflict ? "發生牌張衝突" : "無牌張衝突"}</p>
                </section>
              )}
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function TargetSelection({ state, onEvent }: { state: GameState; onEvent: (event: GameEvent) => void }) {
  const human = state.players.human;
  return (
    <section className="mt-14 text-center">
      <p className="font-mono text-[10px] tracking-[0.3em] text-emerald-300/45">TARGET ALLOCATION</p>
      <h1 className="mt-3 text-3xl font-bold">選擇本局數字</h1>
      <p className="mt-2 text-sm text-emerald-100/50">每張目標數字在一場對局中只能使用一次</p>
      <div className="mt-8 flex justify-center gap-3">
        {human.targets.map((target) => {
          const used = human.usedTargets.includes(target);
          return (
            <button
              key={target}
              aria-label={`選擇目標數字 ${target}`}
              disabled={used}
              onClick={() => onEvent({ type: "target-selected", player: "human", target })}
              aria-pressed={human.selectedTarget === target}
              className={`grid h-32 w-24 place-items-center border bg-emerald-950/70 font-mono text-3xl font-bold text-white shadow-[inset_0_0_30px_rgba(16,185,129,0.06)] transition hover:-translate-y-1 hover:border-emerald-200 disabled:opacity-25 ${human.selectedTarget === target ? "border-amber-200 bg-amber-200/10" : "border-emerald-300/25"}`}
            >
              {target}
            </button>
          );
        })}
      </div>
      {human.selectedTarget !== undefined && (
        <p className="mt-6 font-mono text-sm text-emerald-200/60">等待對手選擇…</p>
      )}
    </section>
  );
}

function BettingPanel({
  state,
  wager,
  setWager,
  preview,
  onPreviewChange,
  onEvent,
}: {
  state: GameState;
  wager: number;
  setWager: (amount: number) => void;
  preview: BiosBettingPreview | null;
  onPreviewChange: (preview: BiosBettingPreview | null) => void;
  onEvent: (event: GameEvent) => void;
}) {
  const limits = getBetLimits(state, "human");
  if (state.currentActor !== "human") {
    return (
      <section className="border border-rose-300/20 bg-rose-300/[0.035] p-4 text-center">
        <p className="font-mono text-xs tracking-[0.18em] text-rose-200/70">AI 正在評估下注…</p>
      </section>
    );
  }

  const canRaise = limits.outstanding > 0 && limits.raiseMax >= 1;
  const maximum = limits.outstanding > 0 ? limits.raiseMax : limits.betMax;
  const previewingCall = preview?.stage === "call";
  const previewingRaise = preview?.stage === "raise";
  const previewingBet = preview?.stage === "bet";
  const sliderValue = previewingRaise
    ? preview.raiseAmount
    : previewingBet
      ? preview.amount
      : Math.min(wager, maximum);
  const updateSlider = (amount: number) => {
    setWager(amount);
    if (previewingRaise) {
      onPreviewChange({ ...preview, raiseAmount: amount });
    } else if (previewingBet) {
      onPreviewChange({ stage: "bet", amount });
    } else if (limits.outstanding === 0 && amount !== wager) {
      onPreviewChange({ stage: "bet", amount });
    }
  };
  const enterRaisePreview = () => {
    const raiseAmount = Math.max(1, Math.min(wager, limits.raiseMax));
    setWager(raiseAmount);
    onPreviewChange({ stage: "raise", callAmount: limits.outstanding, raiseAmount });
  };

  return (
    <section className="border border-amber-200/25 bg-amber-200/[0.035] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[9px] tracking-[0.2em] text-amber-100/45">YOUR ACTION</p>
          <p className="mt-1 font-bold">輪到你行動</p>
        </div>
        {limits.outstanding > 0 && (
          <span className="font-mono text-xs text-rose-200">跟注差額 {limits.outstanding}</span>
        )}
      </div>
      {maximum > 0 && (limits.outstanding === 0 || previewingRaise) && (
        <label className="mt-4 block font-mono text-[10px] text-emerald-100/50">
          {limits.outstanding > 0 ? "額外加注" : "下注"}：{sliderValue} BIOS
          <input
            className="mt-2 w-full accent-amber-200"
            type="range"
            min={1}
            max={maximum}
            value={sliderValue}
            onChange={(event) => updateSlider(Number(event.target.value))}
          />
        </label>
      )}
      {previewingCall && (
        <p className="mt-4 border border-dashed border-cyan-300/40 bg-cyan-300/[0.05] p-2 font-mono text-[10px] text-cyan-100/75">
          跟注預覽 {preview.callAmount} BIOS · 尚未送出
        </p>
      )}
      {previewingRaise && (
        <p className="mt-4 border border-dashed border-amber-200/40 bg-amber-200/[0.05] p-2 font-mono text-[10px] text-amber-100/75">
          加注預覽：跟 {preview.callAmount} BIOS + 加 {preview.raiseAmount} BIOS · 尚未送出
        </p>
      )}
      {previewingBet && (
        <p className="mt-4 border border-dashed border-amber-200/40 bg-amber-200/[0.05] p-2 font-mono text-[10px] text-amber-100/75">
          下注預覽 {preview.amount} BIOS · 尚未送出
        </p>
      )}

      {previewingCall ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            className={`${actionButton} border-rose-300/25 text-rose-200`}
            onClick={() => onEvent({ type: "betting-action", player: "human", action: "fold" })}
          >
            棄注
          </button>
          <button className={actionButton} onClick={() => onPreviewChange(null)}>
            取消預覽
          </button>
          <button
            className={actionButton}
            onClick={() => onEvent({ type: "betting-action", player: "human", action: "call" })}
          >
            只跟注 {limits.outstanding}
          </button>
          <button className={`${actionButton} border-amber-200/45`} onClick={enterRaisePreview}>
            繼續加注
          </button>
        </div>
      ) : previewingRaise ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            className={`${actionButton} border-rose-300/25 text-rose-200`}
            onClick={() => onEvent({ type: "betting-action", player: "human", action: "fold" })}
          >
            棄注
          </button>
          <button className={actionButton} onClick={() => onPreviewChange({ stage: "call", callAmount: limits.outstanding })}>
            返回跟注預覽
          </button>
          <button
            className={`${actionButton} border-amber-200/45`}
            onClick={() => onEvent({ type: "betting-action", player: "human", action: "raise", amount: preview.raiseAmount })}
          >
            確認加注 {preview.raiseAmount}
          </button>
        </div>
      ) : previewingBet ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            className={`${actionButton} border-rose-300/25 text-rose-200`}
            onClick={() => onEvent({ type: "betting-action", player: "human", action: "fold" })}
          >
            棄牌
          </button>
          <button className={actionButton} onClick={() => onEvent({ type: "betting-action", player: "human", action: "check" })}>
            過牌
          </button>
          <button className={actionButton} onClick={() => onPreviewChange(null)}>
            取消預覽
          </button>
          <button
            className={`${actionButton} border-amber-200/45`}
            onClick={() => onEvent({ type: "betting-action", player: "human", action: "bet", amount: preview.amount })}
          >
            確認下注 {preview.amount}
          </button>
        </div>
      ) : (
        <div className={`mt-4 grid gap-2 ${limits.outstanding > 0 ? "grid-cols-2" : "grid-cols-3"}`}>
          <button
            className={`${actionButton} border-rose-300/25 text-rose-200`}
            onClick={() => onEvent({ type: "betting-action", player: "human", action: "fold" })}
          >
            {limits.outstanding > 0 ? "棄注" : "棄牌"}
          </button>
          {limits.outstanding === 0 ? (
            <button
              className={actionButton}
              onClick={() => onEvent({ type: "betting-action", player: "human", action: "check" })}
            >
              過牌
            </button>
          ) : (
            <button
              className={actionButton}
              onClick={() =>
                canRaise
                  ? onPreviewChange({ stage: "call", callAmount: limits.outstanding })
                  : onEvent({ type: "betting-action", player: "human", action: "call" })
              }
            >
              跟注 {limits.outstanding}
            </button>
          )}
          {limits.outstanding === 0 && (
            <button
              className={actionButton}
              disabled={maximum < 1}
              onClick={() => onEvent({ type: "betting-action", player: "human", action: "bet", amount: wager })}
            >
              下注 {wager}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function BettingBeatNotice({ beat }: { beat: BiosBettingBeat }) {
  return (
    <section
      aria-live="polite"
      data-testid="ai-raise-call-beat"
      data-betting-beat="ai-raise-call"
      className="border border-dashed border-cyan-300/35 bg-cyan-300/[0.045] p-4 text-center"
    >
      <p className="font-mono text-[9px] tracking-[0.2em] text-cyan-200/55">BETTING BEAT</p>
      <p className="mt-2 font-mono text-xs text-cyan-100/80">
        AI 先跟注{beat.action === "raise" ? "，準備加注" : ""} · 請稍候
      </p>
    </section>
  );
}

function isBettingPreviewValid(
  limits: ReturnType<typeof getBetLimits>,
  preview: BiosBettingPreview,
): boolean {
  if (preview.stage === "bet") {
    return limits.outstanding === 0 && preview.amount >= 1 && preview.amount <= limits.betMax;
  }
  if (preview.stage === "call") {
    return limits.outstanding >= 1 && preview.callAmount === limits.outstanding;
  }
  return (
    limits.outstanding >= 1 &&
    preview.callAmount === limits.outstanding &&
    preview.raiseAmount >= 1 &&
    preview.raiseAmount <= limits.raiseMax
  );
}

export function StatusPanel({
  label,
  side,
  bios,
  invested,
  pendingInvested = 0,
  chips,
  active,
  history = [],
  hostile = false,
}: {
  label: string;
  side: "left" | "right";
  bios: number;
  invested: number;
  pendingInvested?: number;
  chips: BiosDisplayChip[];
  active: boolean;
  history?: Array<{ round: number; invested: number }>;
  hostile?: boolean;
}) {
  const mirrored = side === "right";
  return (
    <div
      data-panel-side={side}
      className={`min-w-0 border px-5 py-3 ${
        active
          ? hostile
            ? "border-rose-300/55 bg-rose-300/[0.07]"
            : "border-emerald-300/55 bg-emerald-300/[0.07]"
          : "border-emerald-300/10 bg-black/15"
      }`}
    >
      <div className={`flex items-end justify-between ${mirrored ? "flex-row-reverse" : ""}`}>
        <span className={`min-w-0 break-words font-mono text-[10px] tracking-[0.25em] text-emerald-100/45 ${mirrored ? "text-right" : "text-left"}`}>{label}</span>
        <span className={`shrink-0 ${mirrored ? "text-left" : "text-right"}`}>
          <span className="block text-2xl font-black leading-none">{bios}</span>
          <span className="mt-1 block font-mono text-[8px] tracking-[0.18em] text-emerald-100/35">BIOS</span>
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden bg-black/40" aria-hidden="true">
        <div
          className={hostile ? "h-full bg-rose-300" : "h-full bg-emerald-300"}
          style={{ width: `${Math.min(100, (bios / 40) * 100)}%` }}
        />
      </div>
      <div className={`mt-3 flex items-baseline justify-between gap-3 font-mono ${mirrored ? "flex-row-reverse" : ""}`}>
        <span className={`text-[9px] tracking-[0.16em] text-emerald-100/40 ${mirrored ? "text-right" : "text-left"}`}>本局投入</span>
        <span className={`${mirrored ? "text-left" : "text-right"} text-xs text-emerald-100/70`}>
          {invested} BIOS
          {pendingInvested > 0 && <span className="ml-1 text-cyan-100/80">（+{pendingInvested} 待確認）</span>}
        </span>
      </div>
      <BiosChipRail label={label} side={side} chips={chips} />
      {history.length > 0 && <BiosHistoryRail label={label} side={side} rounds={history} />}
    </div>
  );
}

export function BiosChipRail({
  label,
  side,
  chips,
}: {
  label: string;
  side: "left" | "right";
  chips: BiosDisplayChip[];
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const chipsKey = chips.map((chip) => `${chip.id}:${chip.amount}:${chip.preview ?? chip.status}`).join("|");
  const expanded = expandedKey === chipsKey;
  const collapsedProjection = projectCollapsedBiosChips(chips, COLLAPSED_BIOS_CHIP_LIMIT);
  const projection = expanded
    ? { visible: chips, collapsed: collapsedProjection.collapsed, collapsedAmount: collapsedProjection.collapsedAmount }
    : collapsedProjection;
  const railId = `bios-rail-${side}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const displayChips = side === "right" ? [...projection.visible].reverse() : projection.visible;
  const summaryControl = collapsedProjection.collapsed.length > 0 ? (
    <span
      role="listitem"
      className={`min-w-0 ${side === "right" ? "order-last" : ""}`}
    >
      <button
        type="button"
        aria-controls={railId}
        aria-expanded={expanded}
        aria-label={`${label} 較早投入 ${collapsedProjection.collapsedAmount} BIOS，${expanded ? "收合" : "展開"}完整明細`}
        className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border border-dashed border-slate-400/40 bg-slate-500/[0.08] px-1.5 py-0.5 font-mono text-[9px] leading-none text-slate-300/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        onClick={() => setExpandedKey(expanded ? null : chipsKey)}
      >
        <span aria-hidden="true" className="text-[8px]">◌</span>
        <span>較早投入 {collapsedProjection.collapsedAmount}</span>
        <span className="text-[8px]">{expanded ? "收合" : "展開"}</span>
      </button>
    </span>
  ) : null;

  return (
    <div
      id={railId}
      data-rail-layout={expanded ? "expanded" : "two-rows"}
      className={`mt-2 flex min-w-0 flex-wrap gap-1.5 ${side === "right" ? "justify-start" : "justify-end"}`}
      role="list"
      aria-label={`${label} 當局 BIOS 下注籌碼`}
    >
      {summaryControl}
      {displayChips.map((chip) => {
        const kindLabel = chip.kind === "ante" ? "底" : chip.kind === "bet" ? "押" : chip.kind === "call" ? "跟" : "加";
        const statusLabel = chip.preview
          ? chip.preview === "pending-latest"
            ? "，最新，待確認"
            : "，待確認"
          : chip.status === "latest"
            ? "，最新"
            : chip.status === "completed"
              ? "，已完成"
              : "";
        const statusClass = chip.preview === "pending-latest"
          ? chip.kind === "call"
            ? "border-dashed border-cyan-300/65 bg-cyan-300/[0.08] text-cyan-100"
            : "border-dashed border-amber-200/65 bg-amber-200/[0.08] text-amber-100"
          : chip.preview === "pending"
            ? "border-dashed border-slate-300/50 bg-slate-500/[0.08] text-slate-300/75"
            : chip.status === "completed"
              ? "border-slate-400/25 bg-slate-500/[0.08] text-slate-300/60"
              : chip.kind === "call"
                ? "border-cyan-300/55 bg-cyan-300/[0.08] text-cyan-100"
                : chip.kind === "bet" || chip.kind === "raise"
                  ? "border-amber-200/55 bg-amber-200/[0.08] text-amber-100"
                  : "border-emerald-300/30 bg-emerald-300/[0.05] text-emerald-100/70";
        return (
          <span
            key={chip.id}
            role="listitem"
            aria-label={`${label} ${kindLabel} ${chip.amount} BIOS${statusLabel}`}
            className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 font-mono text-[9px] leading-none ${statusClass}`}
          >
            <span aria-hidden="true" className="text-[8px]">◉</span>
            <span>{kindLabel} {chip.amount}</span>
            {chip.status === "latest" && <span className="text-[8px] tracking-[0.08em]">最新</span>}
            {chip.status === "completed" && !chip.preview && <span className="text-[8px] tracking-[0.08em]">完成</span>}
            {chip.preview && <span className="text-[8px] tracking-[0.08em]">・待確認</span>}
            {chip.preview === "pending-latest" && <span className="text-[8px] tracking-[0.08em]">最新</span>}
          </span>
        );
      })}
    </div>
  );
}

function BiosHistoryRail({
  label,
  side,
  rounds,
}: {
  label: string;
  side: "left" | "right";
  rounds: Array<{ round: number; invested: number }>;
}) {
  const displayRounds = side === "right" ? [...rounds].reverse() : rounds;
  return (
    <div className={`mt-3 min-w-0 border-t border-slate-400/15 pt-2 ${side === "right" ? "text-right" : "text-left"}`} aria-label={`${label} 歷史 BIOS 投入`}>
      <p className="font-mono text-[9px] tracking-[0.16em] text-slate-300/45">歷史</p>
      <div className={`mt-1 flex flex-wrap gap-1.5 ${side === "right" ? "justify-start" : "justify-end"}`} role="list">
        {displayRounds.map((summary) => (
          <span
            key={summary.round}
            role="listitem"
            className="inline-flex max-w-full rounded-full border border-slate-400/25 bg-slate-500/[0.08] px-1.5 py-0.5 font-mono text-[9px] text-slate-300/65"
          >
            第 {summary.round} 局・投入 {summary.invested} BIOS
          </span>
        ))}
      </div>
    </div>
  );
}

function OpeningInspection({
  state,
  initialRemaining,
  onChange,
  onExit,
}: {
  state: GameState;
  initialRemaining: number;
  onChange: (remaining: number, complete?: boolean) => void;
  onExit: () => void;
}) {
  const [remaining, setRemaining] = useState(initialRemaining);

  useEffect(() => {
    if (remaining <= 0) {
      queueMicrotask(() => onChange(0, true));
      return;
    }
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      setRemaining((current) => {
        const next = Math.max(0, current - 1);
        queueMicrotask(() => onChange(next, next === 0));
        return next;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [onChange, remaining <= 0]);

  return (
    <main className="grid min-h-dvh place-items-center bg-[#06110d] p-8 text-emerald-50">
      <section className="w-full max-w-5xl border border-emerald-300/20 bg-emerald-950/25 p-10">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-xs tracking-[0.3em] text-emerald-300/45">OPENING INSPECTION</p>
            <h1 className="mt-3 text-4xl font-black">開場檢視</h1>
            <p className="mt-3 max-w-2xl text-emerald-100/55">先觀察五張私密目標數字的潛力與使用順序。牌池會隨每局改變，現在不需要預先解完五組牌。</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] tracking-[0.18em] text-emerald-100/35">INSPECTION WINDOW</p>
            <p className="mt-1 font-mono text-5xl font-black text-amber-100">{remaining}s</p>
          </div>
        </div>
        <div className="mt-10 grid grid-cols-5 gap-4" aria-label="開場五張私密目標數字">
          {state.players.human.targets.map((target, index) => (
            <div key={target} className="border border-emerald-300/25 bg-black/20 p-6 text-center">
              <span className="font-mono text-[9px] tracking-[0.18em] text-emerald-300/35">TARGET {index + 1}</span>
              <strong className="mt-3 block text-5xl">{target}</strong>
            </div>
          ))}
        </div>
        <div className="mt-8 flex items-center justify-between">
          <button className={actionButton} onClick={onExit}>← 稍後繼續</button>
          <button className={`${actionButton} border-amber-200/45 bg-amber-200/10 px-8`} onClick={() => onChange(0, true)}>
            開始第一局
          </button>
        </div>
      </section>
    </main>
  );
}

function RoundReveal({
  round,
  state,
  events,
  settlementBeat,
  onContinue,
}: {
  round: RoundRecord;
  state: GameState;
  events: RecordedEvent[];
  settlementBeat: BiosBettingBeat | null;
  onContinue: () => void;
}) {
  const cards = useMemo(() => new Map(createDeck().map((card) => [card.id, card])), []);
  const biosLedger = useMemo(
    () => projectBiosBettingLedger(events, state, round.round),
    [events, round.round, state],
  );
  const displayLedger = useMemo(
    () =>
      settlementBeat
        ? projectBiosBettingBeatLedger(biosLedger, settlementBeat, "settlement")
        : biosLedger,
    [biosLedger, settlementBeat],
  );
  const completedBiosLedgers = useMemo(
    () => projectCompletedBiosLedgers(events, state),
    [events, state],
  );
  const previousBiosLedgers = completedBiosLedgers.filter((ledger) => ledger.round < round.round);
  const outcome =
    round.outcome === "fold"
      ? `${round.winner === "human" ? "AI" : "你"}棄牌，底池直接移轉`
      : round.winner === "human"
        ? "你贏得本局"
        : round.winner === "ai"
          ? "AI 贏得本局"
          : "雙方平分底池";

  return (
    <main className="grid min-h-dvh place-items-center bg-[#06110d] p-8 text-emerald-50">
      <section className="w-full max-w-5xl border border-emerald-300/20 bg-emerald-950/25 p-9">
        <p className="font-mono text-xs tracking-[0.3em] text-emerald-300/45">ROUND {round.round} REVEAL</p>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <h1 className="text-4xl font-black">第 {round.round} 局揭露</h1>
            <p className="mt-2 text-emerald-100/55">{outcome} · 底池 {round.pot} BIOS</p>
          </div>
          {round.conflict && round.winner && (
            <span className="border border-rose-300/35 bg-rose-300/[0.07] px-4 py-2 font-mono text-xs text-rose-200">CARD CONFLICT · 敗者 -{round.round} BIOS</span>
          )}
          {round.conflict && !round.winner && (
            <span className="border border-emerald-300/25 bg-emerald-300/[0.05] px-4 py-2 font-mono text-xs text-emerald-100/60">SHARED CARDS · 平手不追加損失</span>
          )}
        </div>

        <section className="mt-8" aria-label={`第 ${round.round} 局 BIOS 投入明細`}>
          <div className="mb-2 flex items-center justify-between">
            <p className="font-mono text-[9px] tracking-[0.25em] text-slate-300/55">本局 BIOS 明細</p>
            <p className="font-mono text-[9px] text-slate-300/45">
              {settlementBeat ? "最後行動 · 即將揭露" : "已完成 · 灰色表示已結算"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {(["human", "ai"] as const).map((player) => (
              <StatusPanel
                key={player}
                label={player === "human" ? "YOU" : "AI // NEMESIS"}
                side={player === "human" ? "left" : "right"}
                bios={round.biosAfter?.[player] ?? state.players[player].bios}
                invested={displayLedger.players[player].invested}
                chips={displayLedger.players[player].chips}
                active={false}
                history={previousBiosLedgers.map((ledger) => ({
                  round: ledger.round,
                  invested: ledger.players[player].invested,
                }))}
                hostile={player === "ai"}
              />
            ))}
          </div>
        </section>

        <div className="mt-8 grid grid-cols-2 gap-4">
          {(["human", "ai"] as const).map((player) => {
            const hand = round.hands[player];
            const total = hand.reduce((sum, id) => sum + (cards.get(id)?.value ?? 0), 0);
            return (
              <section key={player} className={`border p-5 ${round.winner === player ? "border-amber-200/45 bg-amber-200/[0.055]" : "border-emerald-300/12 bg-black/20"}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono text-[10px] tracking-[0.2em] text-emerald-100/40">{player === "human" ? "YOU" : "AI // NEMESIS"}</p>
                    <p className="mt-1 text-2xl font-black">目標 {round.targets[player]}</p>
                  </div>
                  <div className="text-right text-sm text-emerald-100/55">
                    <p>總和 {total}</p>
                    <p>{round.outcome === "fold" ? "棄牌局不比較牌型" : round.validity?.[player] ? round.handLabels?.[player] : "無效提交"}</p>
                    {round.outcome !== "fold" && round.invalidReasons?.[player] && (
                      <p className="mt-1 text-rose-200">
                        {round.invalidReasons[player]!.map(invalidReasonLabel).join("、")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-5 gap-2">
                  {hand.map((id) => {
                    const card = cards.get(id);
                    return (
                      <div key={id} className="grid aspect-[0.72] place-items-center border border-emerald-300/20 bg-emerald-950/45 text-lg font-bold">
                        {card ? `${card.rank}${suitGlyphs[card.suit]}` : id}
                      </div>
                    );
                  })}
                  {Array.from({ length: Math.max(0, 5 - hand.length) }, (_, index) => (
                    <div key={`empty-${index}`} className="grid aspect-[0.72] place-items-center border border-dashed border-rose-300/20 text-rose-200/30">—</div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <p className="mt-5 text-xs leading-5 text-emerald-100/45">本局鎖定組合中原本可用的牌已更新為已使用；若雙方牌型相同則平分底池，不另計衝突損失。</p>
        <button
          className={`${actionButton} mt-6 w-full`}
          disabled={Boolean(settlementBeat)}
          onClick={onContinue}
        >
          {settlementBeat
            ? "揭露中…"
            : state.phase === "complete"
              ? "查看對局報告"
              : `進入第 ${state.round} 局`}
        </button>
      </section>
    </main>
  );
}

function ResultsScreen({
  state,
  events,
  onExit,
  onExport,
}: {
  state: GameState;
  events: RecordedEvent[];
  onExit: () => void;
  onExport: () => void;
}) {
  const humanWins = state.history.filter((round) => round.winner === "human").length;
  const validRounds = state.history.filter((round) => round.validity?.human).length;
  const conflicts = state.history.filter((round) => round.conflict).length;
  const replayStates = projectReplayStates(events, state);
  const humanActions = events.filter(
    (record) => record.event.type === "betting-action" && record.event.player === "human",
  ).length;
  const averageBuildTime = calculateAverageBuildTime(state, events, replayStates);
  const bluffs = countHumanBluffs(events, replayStates);
  const completedBiosLedgers = useMemo(
    () => projectCompletedBiosLedgers(events, state),
    [events, state],
  );
  return (
    <main className="grid min-h-dvh place-items-center bg-[#06110d] p-8 text-emerald-50">
      <section className="w-full max-w-3xl border border-emerald-300/20 bg-emerald-950/25 p-10">
        <p className="font-mono text-xs tracking-[0.3em] text-emerald-300/45">MATCH COMPLETE</p>
        <h1 className="mt-4 text-6xl font-black">
          {state.winner === "human" ? "你存活了" : state.winner === "ai" ? "連線終止" : "平手"}
        </h1>
        <div className="mt-8 grid grid-cols-4 gap-3">
          <Metric label="最終 BIOS" value={`${state.players.human.bios}`} />
          <Metric label="勝局" value={`${humanWins} / ${state.history.length}`} />
          <Metric label="有效提交率" value={`${Math.round((validRounds / Math.max(1, state.history.length)) * 100)}%`} />
          <Metric label="牌張衝突" value={`${conflicts}`} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Metric label="平均初次組牌" value={averageBuildTime === null ? "—" : `${averageBuildTime}s`} />
          <Metric label="下注行動" value={`${humanActions}`} />
          <Metric label="成功詐唬" value={`${bluffs}`} />
        </div>
        <div className="mt-8">
          <p className="mb-2 font-mono text-[9px] tracking-[0.22em] text-slate-300/55">歷史 BIOS 投入</p>
          <div className="space-y-2" role="list" aria-label="歷史 BIOS 投入摘要">
          {state.history.map((round, index) => {
            const before = index === 0 ? 25 : state.history[index - 1].biosAfter?.human;
            const after = round.biosAfter?.human;
            const delta = before !== undefined && after !== undefined ? after - before : undefined;
            const ledger = completedBiosLedgers[index];
            return (
            <div
              key={round.round}
              role="listitem"
              aria-label={`第 ${round.round} 局 BIOS 投入摘要`}
              className="grid grid-cols-[70px_120px_1fr_100px_80px] border-b border-emerald-300/10 py-2 font-mono text-xs text-emerald-100/55"
            >
              <span>第 {round.round} 局</span>
              <span>{round.targets.human} vs {round.targets.ai}</span>
              <span>
                <span className="block">{round.handLabels?.human ?? "未驗證"} / {round.handLabels?.ai ?? "未驗證"}</span>
                {ledger && (
                  <span className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-slate-300/60">
                    <span>第 {round.round} 局・投入 {ledger.players.human.invested} BIOS</span>
                    <span>第 {round.round} 局・投入 {ledger.players.ai.invested} BIOS</span>
                  </span>
                )}
              </span>
              <span>BIOS {after ?? "—"} {delta === undefined ? "" : `(${delta >= 0 ? "+" : ""}${delta})`}</span>
              <span className="text-right">{round.winner === "human" ? "WIN" : round.winner === "ai" ? "LOSS" : "DRAW"}</span>
            </div>
            );
          })}
          </div>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3">
          <button className={actionButton} onClick={onExport}>匯出完整 JSON</button>
          <button className={actionButton} onClick={onExit}>返回主選單</button>
        </div>
      </section>
    </main>
  );
}

function calculateAverageBuildTime(
  state: GameState,
  events: RecordedEvent[],
  replayStates: Array<GameState | undefined>,
): number | null {
  const durations = state.history.flatMap((round) => {
    const startIndex = events.findIndex(
      (_, index) => replayStates[index]?.round === round.round && replayStates[index]?.phase === "construction",
    );
    const lockedIndex = events.findIndex(
      (record, index) =>
        record.event.type === "hand-locked" &&
        record.event.player === "human" &&
        (replayStates[index]?.round === round.round || replayStates[index]?.history.at(-1)?.round === round.round),
    );
    const start = events[startIndex];
    const locked = events[lockedIndex];
    return start && locked && locked.at >= start.at ? [(locked.at - start.at) / 1000] : [];
  });
  if (durations.length === 0) return null;
  return Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length);
}

function countHumanBluffs(
  events: RecordedEvent[],
  replayStates: Array<GameState | undefined>,
): number {
  let count = 0;
  events.forEach((record, index) => {
    if (
      record.event.type !== "betting-action" ||
      record.event.player !== "ai" ||
      record.event.action !== "fold"
    ) {
      return;
    }
    const before = replayStates[index - 1];
    if (!before) return;
    const humanTarget = before.players.human.selectedTarget;
    const aiTarget = before.players.ai.selectedTarget;
    if (humanTarget === undefined || aiTarget === undefined) return;
    const human = evaluateSubmission({
      cardIds: before.players.human.lockedCards ?? [],
      target: humanTarget,
      availableCardIds: before.availableCardIds,
    });
    const ai = evaluateSubmission({
      cardIds: before.players.ai.lockedCards ?? [],
      target: aiTarget,
      availableCardIds: before.availableCardIds,
    });
    if (!human.valid || (ai.valid && compareHands(human.hand, ai.hand) <= 0)) count += 1;
  });
  return count;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-emerald-300/12 bg-black/20 p-4">
      <p className="font-mono text-[9px] tracking-[0.18em] text-emerald-100/35">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function invalidReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    "card-count": "不是五張實際牌",
    "duplicate-card": "包含重複實際牌",
    "wrong-total": "總和未命中目標",
    "used-card": "包含先前已使用牌",
  };
  return labels[reason] ?? reason;
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reducedMotion;
}

function useMatchTimer(
  state: GameState,
  onEvent: (event: GameEvent) => void,
  savedTimer?: { key?: string; remaining?: number | null },
  onTimerChange?: (key: string, remaining: number | null) => void,
  paused = false,
  onTimeout?: () => void,
) {
  const key = [
    state.round,
    state.phase,
    paused ? "paused" : "active",
    state.correctionAttempt,
    state.currentActor ?? "none",
    state.players.human.selectedTarget ?? "none",
    state.players.human.lockedCards ? "locked" : "open",
  ].join(":");
  const duration = paused ? null : timerDuration(state);
  const [remaining, setRemaining] = useState<number | null>(() =>
    savedTimer?.key === key && savedTimer.remaining !== undefined
      ? savedTimer.remaining
      : duration,
  );
  const previousKey = useRef(key);
  const firedKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (previousKey.current === key) return;
    previousKey.current = key;
    firedKey.current = undefined;
    setRemaining(savedTimer?.key === key && savedTimer.remaining !== undefined ? savedTimer.remaining : duration);
  }, [duration, key, savedTimer?.key, savedTimer?.remaining]);

  useEffect(() => {
    onTimerChange?.(key, remaining);
  }, [key, onTimerChange, remaining]);

  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      setRemaining((current) => {
        if (current === null || current <= 0) return current;
        if (current <= 1) {
          if (firedKey.current !== key) {
            firedKey.current = key;
            queueMicrotask(() => {
              onTimeout?.();
              onEvent(timeoutEventFor(state, "human"));
            });
          }
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [key, onEvent, onTimeout, remaining === null, state]);

  return { key, remaining };
}

function timerDuration(state: GameState): number | null {
  if (state.settings.timerPreset === "untimed") return null;
  const relaxed = state.settings.timerPreset === "relaxed";
  if (state.phase === "number-selection") {
    return state.players.human.selectedTarget === undefined ? (relaxed ? 20 : 10) : null;
  }
  if (state.phase === "construction" || state.phase === "correction") {
    return state.players.human.lockedCards === undefined ? (relaxed ? 150 : 100) : null;
  }
  if (state.phase === "betting") {
    return state.currentActor === "human" ? (relaxed ? 60 : 30) : null;
  }
  return null;
}
