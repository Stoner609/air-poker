import { useCallback, useEffect, useMemo, useState } from "react";
import { NUMBER_PACKS } from "./content/number-packs";
import { MatchScreen } from "./components/MatchScreen";
import {
  loadSettings,
  ReplayScreen,
  SettingsScreen,
  TutorialScreen,
} from "./components/SecondaryScreens";
import { chooseAiBettingAction, chooseAiHand, chooseAiTarget, createAiView } from "./domain/ai";
import { createMatch, transition, type GameEvent } from "./domain/game";
import { evaluateSubmission } from "./domain/hand";
import {
  MatchRepository,
  type MatchRecord,
  type RecordedEvent,
} from "./services/match-repository";
import { solveInBackground } from "./services/solver-service";

type Screen = "menu" | "match" | "tutorial" | "replays" | "settings";

const primaryButton =
  "group flex w-full items-center justify-between border border-emerald-300/25 bg-emerald-300/[0.045] px-5 py-3 text-left font-mono text-sm tracking-[0.12em] text-emerald-50 transition hover:border-emerald-200/70 hover:bg-emerald-300/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-30";
const FIRST_MATCH_KEY = "air-poker:first-match-started:v1";

export function App() {
  const repository = useMemo(() => new MatchRepository(window.localStorage), []);
  const [screen, setScreen] = useState<Screen>("menu");
  const [matchRecord, setMatchRecord] = useState<MatchRecord | null>(null);
  const hasActiveMatch = repository.loadActive() !== null;

  const startNewMatch = () => {
    const seed = Date.now() >>> 0;
    const assisted = localStorage.getItem(FIRST_MATCH_KEY) !== "yes";
    const state = createMatch({
      seed,
      numberPack: NUMBER_PACKS[seed % NUMBER_PACKS.length],
      settings: {
        assisted,
        timerPreset: assisted ? "relaxed" : loadSettings().timerPreset,
      },
    });
    const record: MatchRecord = {
      version: 1,
      state,
      events: [{ sequence: 0, at: Date.now(), event: { type: "match-created" }, state }],
      savedAt: Date.now(),
      openingInspectionComplete: false,
      openingInspectionRemaining: 20,
      acknowledgedRounds: 0,
    };
    localStorage.setItem(FIRST_MATCH_KEY, "yes");
    repository.saveActive(record);
    setMatchRecord(record);
    setScreen("match");
  };

  const continueMatch = () => {
    const record = repository.loadActive();
    if (!record) return;
    setMatchRecord(record);
    setScreen("match");
  };

  const applyEvent = useCallback((event: GameEvent) => {
    setMatchRecord((current) => {
      if (!current) return current;
      const state = transition(current.state, event).state;
      const next: MatchRecord = {
        ...current,
        state,
        savedAt: Date.now(),
        events: [
          ...current.events,
          { sequence: current.events.length, at: Date.now(), event },
        ],
      };
      if (state.phase === "complete") {
        repository.saveCompleted(next);
        repository.clearActive();
      } else repository.saveActive(next);
      return next;
    });
  }, [repository]);

  const saveTimer = useCallback((timerKey: string, timerRemaining: number | null) => {
    setMatchRecord((current) => {
      if (
        !current ||
        current.state.phase === "complete" ||
        (current.timerKey === timerKey && current.timerRemaining === timerRemaining)
      ) {
        return current;
      }
      const next = { ...current, timerKey, timerRemaining, savedAt: Date.now() };
      repository.saveActive(next);
      return next;
    });
  }, [repository]);

  const recordSystemEvent = useCallback((event: RecordedEvent["event"]) => {
    setMatchRecord((current) => {
      if (!current || current.state.phase === "complete") return current;
      const last = current.events.at(-1)?.event;
      if (last?.type === event.type && (event.type === "timer-paused" || event.type === "timer-resumed")) {
        return current;
      }
      const next: MatchRecord = {
        ...current,
        savedAt: Date.now(),
        events: [
          ...current.events,
          {
            sequence: current.events.length,
            at: Date.now(),
            event,
          },
        ],
      };
      repository.saveActive(next);
      return next;
    });
  }, [repository]);

  const saveOpeningInspection = useCallback((remaining: number, complete = false) => {
    setMatchRecord((current) => {
      if (!current) return current;
      if (
        current.openingInspectionRemaining === remaining &&
        Boolean(current.openingInspectionComplete) === complete
      ) {
        return current;
      }
      const next = {
        ...current,
        openingInspectionRemaining: remaining,
        openingInspectionComplete: complete,
        savedAt: Date.now(),
      };
      repository.saveActive(next);
      return next;
    });
  }, [repository]);

  const acknowledgeReveal = useCallback(() => {
    setMatchRecord((current) => {
      if (!current) return current;
      const next = {
        ...current,
        acknowledgedRounds: current.state.history.length,
        savedAt: Date.now(),
      };
      if (current.state.phase === "complete") repository.saveCompleted(next);
      else repository.saveActive(next);
      return next;
    });
  }, [repository]);

  useEffect(() => {
    if (screen !== "match") return;
    const onVisibilityChange = () => {
      recordSystemEvent({
        type: document.hidden ? "timer-paused" : "timer-resumed",
        phase: matchRecord?.state.phase,
      });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [matchRecord?.state.phase, recordSystemEvent, screen]);

  const automationKey = matchRecord
    ? [
        matchRecord.state.phase,
        matchRecord.state.round,
        matchRecord.state.correctionAttempt,
        matchRecord.state.currentActor,
        matchRecord.state.players.ai.selectedTarget,
        matchRecord.state.players.ai.lockedCards?.join(","),
        matchRecord.state.pot,
        matchRecord.openingInspectionComplete,
        matchRecord.acknowledgedRounds,
      ].join(":")
    : "idle";

  useEffect(() => {
    if (screen !== "match" || !matchRecord) return;
    const state = matchRecord.state;
    if (
      !matchRecord.openingInspectionComplete ||
      state.history.length > (matchRecord.acknowledgedRounds ?? 0)
    ) {
      return;
    }
    const aiView = createAiView(state);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (state.phase === "number-selection" && state.players.ai.selectedTarget === undefined) {
      timer = setTimeout(() => {
        if (!cancelled) {
          applyEvent({ type: "target-selected", player: "ai", target: chooseAiTarget(aiView) });
        }
      }, 360 + Math.floor((state.seed % 5) * 70));
    }

    if (
      (state.phase === "construction" || state.phase === "correction") &&
      state.players.ai.lockedCards === undefined
    ) {
      timer = setTimeout(() => {
        void solveInBackground({
          target: state.players.ai.selectedTarget!,
          availableCardIds: state.availableCardIds,
          limit: 24,
        }).then((solutions) => {
          if (cancelled) return;
          const cardIds =
            solutions.length > 0
              ? chooseAiHand(aiView, solutions).cardIds
              : state.availableCardIds.slice(0, 5);
          applyEvent({ type: "hand-locked", player: "ai", cardIds });
        });
      }, 520 + Math.floor((state.seed % 7) * 80));
    }

    if (state.phase === "betting" && state.currentActor === "ai") {
      const result = evaluateSubmission({
        cardIds: state.players.ai.lockedCards ?? [],
        target: state.players.ai.selectedTarget!,
        availableCardIds: state.availableCardIds,
      });
      const solution = result.valid
        ? { cardIds: [...(state.players.ai.lockedCards ?? [])], total: result.total, hand: result.hand }
        : undefined;
      timer = setTimeout(() => {
        if (cancelled) return;
        const decision = chooseAiBettingAction(aiView, solution);
        applyEvent({ type: "betting-action", player: "ai", ...decision });
      }, 620 + Math.floor((state.seed % 9) * 75));
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [automationKey, applyEvent, screen]);

  if (screen === "match" && matchRecord) {
    return (
      <MatchScreen
        state={matchRecord.state}
        events={matchRecord.events}
        onEvent={applyEvent}
        onExit={() => setScreen("menu")}
        openingInspectionComplete={Boolean(matchRecord.openingInspectionComplete)}
        openingInspectionRemaining={matchRecord.openingInspectionRemaining ?? 20}
        onOpeningInspectionChange={saveOpeningInspection}
        acknowledgedRounds={matchRecord.acknowledgedRounds ?? 0}
        onAcknowledgeReveal={acknowledgeReveal}
        onSystemEvent={recordSystemEvent}
        onExport={() => downloadRecord(repository, matchRecord)}
        savedTimer={{ key: matchRecord.timerKey, remaining: matchRecord.timerRemaining }}
        onTimerChange={saveTimer}
      />
    );
  }

  if (screen === "tutorial") return <TutorialScreen onExit={() => setScreen("menu")} />;
  if (screen === "settings") return <SettingsScreen onExit={() => setScreen("menu")} />;
  if (screen === "replays") {
    return <ReplayScreen repository={repository} onExit={() => setScreen("menu")} />;
  }

  if (screen !== "menu") {
    return (
      <main className="min-h-dvh bg-[#06110d] p-8 text-emerald-50">
        <button className={primaryButton + " max-w-52"} onClick={() => setScreen("menu")}>
          <span>返回主選單</span>
          <span aria-hidden="true">←</span>
        </button>
        <p className="mt-16 text-center font-mono text-emerald-100/50">{screen} 模組準備中</p>
      </main>
    );
  }

  return (
    <main className="relative grid min-h-dvh overflow-hidden bg-[#06110d] text-[#d8ffe8]">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(82,255,171,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(82,255,171,0.04)_1px,transparent_1px)] [background-size:34px_34px]" />
      <div className="pointer-events-none absolute left-[12%] top-[-18%] h-[42rem] w-[42rem] rounded-full bg-emerald-400/8 blur-[140px]" />

      <section className="relative mx-auto grid min-h-dvh w-full max-w-[1180px] grid-cols-[1.2fr_0.8fr] items-center gap-20 px-16 py-12">
        <div>
          <div className="mb-8 flex items-center gap-3 font-mono text-xs tracking-[0.34em] text-emerald-300/65">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_18px_#6ee7b7]" />
            BIOS LINK ESTABLISHED
          </div>
          <h1
            aria-label="AIR POKER"
            className="text-[6.5rem] font-black leading-[0.78] tracking-[-0.075em] text-white"
          >
            AIR
            <br />
            <span className="text-emerald-300">POKER</span>
          </h1>
          <p className="mt-10 max-w-xl text-lg leading-8 text-emerald-50/62">
            從五張私密數字中選出本局目標，以仍可使用的牌構成最強牌型，然後拿生命資源賭對手沒有你強。
          </p>
          <div className="mt-10 flex gap-8 font-mono text-[11px] tracking-[0.18em] text-emerald-200/40">
            <span>01 數字調度</span>
            <span>02 限時組牌</span>
            <span>03 心理下注</span>
          </div>
        </div>

        <nav aria-label="主選單" className="border-l border-emerald-300/15 pl-12">
          <p className="mb-5 font-mono text-[10px] tracking-[0.3em] text-emerald-300/45">
            SELECT PROTOCOL
          </p>
          <div className="space-y-3">
            <button
              className={primaryButton}
              disabled={!hasActiveMatch}
              onClick={continueMatch}
            >
              <span>繼續對局</span>
              <span aria-hidden="true">CONTINUE</span>
            </button>
            <button className={primaryButton} onClick={startNewMatch}>
              <span>新對局</span>
              <span aria-hidden="true">NEW MATCH</span>
            </button>
            <button className={primaryButton} onClick={() => setScreen("tutorial")}>
              <span>教學</span>
              <span aria-hidden="true">TRAINING</span>
            </button>
            <button className={primaryButton} onClick={() => setScreen("replays")}>
              <span>重播／匯入紀錄</span>
              <span aria-hidden="true">ARCHIVE</span>
            </button>
            <button className={primaryButton} onClick={() => setScreen("settings")}>
              <span>設定</span>
              <span aria-hidden="true">CONFIG</span>
            </button>
          </div>
          <p className="mt-6 font-mono text-[10px] leading-5 text-emerald-100/30">
            PROTOTYPE 0.1 · LOCAL SESSION
            <br />
            NO TELEMETRY TRANSMITTED
          </p>
        </nav>
      </section>
    </main>
  );
}

function downloadRecord(repository: MatchRepository, record: MatchRecord) {
  const blob = new Blob([repository.exportRecord(record)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${record.state.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
