import { useMemo, useState } from "react";
import type { MatchSettings } from "../domain/game";
import type { MatchRecord } from "../services/match-repository";
import { MatchRepository } from "../services/match-repository";
import { projectReplayStates } from "../services/replay";

const buttonClass =
  "border border-emerald-300/25 bg-emerald-300/[0.055] px-4 py-2 font-mono text-xs tracking-[0.12em] text-emerald-50 transition hover:border-emerald-200/70 hover:bg-emerald-300/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300";

const replayPhaseNames = {
  "number-selection": "選擇數字",
  construction: "候選組牌",
  betting: "心理下注",
  correction: "修正選牌",
  reveal: "結算",
  complete: "對局完成",
} as const;

const tutorialSteps = [
  {
    code: "01 / SUM",
    title: "數字組牌",
    description: "每局公開一個目標數字。選出五張不同的實際牌，讓點數總和恰好命中目標。A 固定算 1，J、Q、K 分別是 11、12、13。",
    target: 15,
    cards: ["A♠", "2♥", "3♦", "4♣", "5♠"],
    callout: "1 + 2 + 3 + 4 + 5 = 15",
  },
  {
    code: "02 / RANK",
    title: "牌型最佳化",
    description: "總和正確只是第一步。同一個目標通常有多組答案；標準撲克牌型較強者贏得底池。",
    target: 25,
    cards: ["3♣", "4♣", "5♣", "6♣", "7♣"],
    callout: "7 高同花順，比一般高牌更強",
  },
  {
    code: "03 / VALID",
    title: "有效與無效提交",
    description: "少於五張、總和錯誤、重複實際牌或使用已使用牌都會使正式提交無效。只有雙方同時無效才會保留底池並修正選牌。",
    target: 22,
    cards: ["A♠", "2♥", "3♦", "7♣", "9♠"],
    callout: "單方無效會直接輸掉該局",
  },
  {
    code: "04 / STATE",
    title: "共享牌張狀態",
    description: "正式分出結果後，雙方鎖定組合中原本可用的牌會標記為已使用。牌仍顯示、仍可點選，但再次提交會無效。",
    target: 39,
    cards: ["9♠", "9♥", "9♦", "9♣", "3♠"],
    callout: "現在的強牌，可能破壞未來的答案",
  },
  {
    code: "05 / BET",
    title: "數字調度與下注",
    description: "組牌鎖定後才開始下注。你已知道自己的牌，卻只看得到對手的公開數字；可以過牌、下注、跟注、再加注或棄牌。",
    target: 47,
    cards: ["10♠", "J♠", "Q♠", "K♠", "A♠"],
    callout: "用 BIOS 為你的判斷承擔風險",
  },
] as const;

export type LocalSettings = {
  timerPreset: MatchSettings["timerPreset"];
};

export const SETTINGS_KEY = "air-poker:settings:v1";

export function loadSettings(): LocalSettings {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as LocalSettings | null;
    if (value && ["standard", "relaxed", "untimed"].includes(value.timerPreset)) return value;
  } catch {
    // Use defaults when local settings are malformed.
  }
  return { timerPreset: "standard" };
}

export function TutorialScreen({ onExit }: { onExit: () => void }) {
  const [step, setStep] = useState(0);
  const current = tutorialSteps[step];
  const complete = () => {
    localStorage.setItem("air-poker:tutorial-complete", "yes");
    onExit();
  };

  return (
    <ScreenShell eyebrow="TRAINING PROTOCOL" title="訓練協定" onExit={onExit}>
      <div className="grid grid-cols-[220px_1fr] gap-8">
        <ol className="space-y-2" aria-label="教學進度">
          {tutorialSteps.map((item, index) => (
            <li key={item.code}>
              <button
                className={`w-full border px-3 py-3 text-left font-mono text-xs ${
                  index === step
                    ? "border-emerald-200/60 bg-emerald-300/10 text-white"
                    : "border-emerald-300/10 text-emerald-100/35"
                }`}
                onClick={() => setStep(index)}
              >
                <span className="block text-[9px] tracking-[0.18em] text-emerald-300/45">{item.code}</span>
                <span className="mt-1 block">{item.title}</span>
              </button>
            </li>
          ))}
        </ol>

        <section className="border border-emerald-300/15 bg-black/20 p-8">
          <p className="font-mono text-[10px] tracking-[0.22em] text-emerald-300/45">TARGET {current.target}</p>
          <h2 className="mt-3 text-3xl font-black">{current.title}</h2>
          <p className="mt-4 max-w-2xl leading-7 text-emerald-50/62">{current.description}</p>
          <div className="mt-8 flex gap-3" aria-label="教學範例牌組">
            {current.cards.map((card) => (
              <div
                key={card}
                className="grid h-28 w-20 place-items-center border border-emerald-300/25 bg-emerald-950/55 text-2xl font-bold"
              >
                {card}
              </div>
            ))}
          </div>
          <div className="mt-6 border-l-2 border-amber-200/55 bg-amber-200/[0.045] px-4 py-3 text-sm text-amber-100/75">
            {current.callout}
          </div>
          <div className="mt-8 flex justify-between">
            <button className={buttonClass} disabled={step === 0} onClick={() => setStep(step - 1)}>
              上一步
            </button>
            {step < tutorialSteps.length - 1 ? (
              <button className={buttonClass} onClick={() => setStep(step + 1)}>下一步</button>
            ) : (
              <button className={buttonClass} onClick={complete}>完成教學</button>
            )}
          </div>
        </section>
      </div>
    </ScreenShell>
  );
}

export function SettingsScreen({ onExit }: { onExit: () => void }) {
  const [settings, setSettings] = useState(loadSettings);
  const save = (timerPreset: LocalSettings["timerPreset"]) => {
    const next = { timerPreset };
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  };
  const choices = [
    ["standard", "標準", "數字 10 秒 · 組牌 100 秒 · 行動 30 秒"],
    ["relaxed", "寬鬆", "數字 20 秒 · 組牌 150 秒 · 行動 60 秒"],
    ["untimed", "無倒數", "適合學習規則與除錯"],
  ] as const;

  return (
    <ScreenShell eyebrow="LOCAL CONFIGURATION" title="系統設定" onExit={onExit}>
      <section className="max-w-3xl border border-emerald-300/15 bg-black/20 p-7">
        <h2 className="text-lg font-bold">倒數模式</h2>
        <p className="mt-2 text-sm text-emerald-100/45">每場對局會保存所使用的設定；切換分頁時倒數暫停。</p>
        <div className="mt-5 space-y-3">
          {choices.map(([value, label, description]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-4 border p-4 ${
                settings.timerPreset === value
                  ? "border-emerald-200/55 bg-emerald-300/[0.08]"
                  : "border-emerald-300/10"
              }`}
            >
              <input
                type="radio"
                name="timer-preset"
                value={value}
                checked={settings.timerPreset === value}
                onChange={() => save(value)}
                className="accent-emerald-300"
              />
              <span>
                <strong className="block">{label}</strong>
                <span className="mt-1 block text-xs text-emerald-100/40">{description}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-6 border-t border-emerald-300/10 pt-5 text-xs leading-6 text-emerald-100/40">
          <p>聲音：第一版停用</p>
          <p>資料：只保存在目前裝置，不傳送遙測</p>
          <p>輸入：滑鼠與鍵盤</p>
        </div>
      </section>
    </ScreenShell>
  );
}

export function ReplayScreen({
  repository,
  onExit,
}: {
  repository: MatchRepository;
  onExit: () => void;
}) {
  const [records, setRecords] = useState(() => repository.listCompleted());
  const [selected, setSelected] = useState<MatchRecord | null>(records[0] ?? null);
  const [step, setStep] = useState(selected?.events.length ? selected.events.length - 1 : 0);
  const [importError, setImportError] = useState<string | null>(null);
  const replayStates = useMemo(
    () => selected ? projectReplayStates(selected.events, selected.state) : [],
    [selected],
  );
  const replayState = replayStates[step] ?? selected?.state;

  const importRecord = async (file: File | undefined) => {
    if (!file) return;
    try {
      const record = repository.importRecord(await file.text());
      setRecords(repository.listCompleted());
      setSelected(record);
      setStep(Math.max(0, record.events.length - 1));
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "無法匯入紀錄");
    }
  };

  return (
    <ScreenShell eyebrow="LOCAL EVENT ARCHIVE" title="對局檔案庫" onExit={onExit}>
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm text-emerald-100/45">最近 20 場完整事件紀錄；所有隱藏資訊只在賽後揭露。</p>
        <label className={buttonClass + " cursor-pointer"}>
          匯入 JSON
          <input
            className="sr-only"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importRecord(event.target.files?.[0])}
          />
        </label>
      </div>
      {importError && (
        <p role="alert" className="mb-4 border border-rose-300/25 bg-rose-300/[0.05] px-4 py-2 text-sm text-rose-100/75">{importError}</p>
      )}
      {records.length === 0 ? (
        <div className="grid min-h-72 place-items-center border border-dashed border-emerald-300/15 text-center text-emerald-100/35">
          <p>尚無完成的對局紀錄<br /><span className="font-mono text-xs">COMPLETE A MATCH OR IMPORT JSON</span></p>
        </div>
      ) : (
        <div className="grid grid-cols-[290px_1fr] gap-4">
          <div className="space-y-2">
            {records.map((record) => (
              <button
                key={record.state.id}
                className={`w-full border p-3 text-left ${selected?.state.id === record.state.id ? "border-emerald-200/50 bg-emerald-300/10" : "border-emerald-300/10"}`}
                onClick={() => {
                  setSelected(record);
                  setStep(Math.max(0, record.events.length - 1));
                }}
              >
                <strong className="block text-sm">Seed {record.state.seed}</strong>
                <span className="mt-1 block font-mono text-[10px] text-emerald-100/35">{record.state.history.length} 局 · {record.state.winner ?? "未完成"}</span>
              </button>
            ))}
          </div>
          {selected && replayState && (
            <section className="border border-emerald-300/15 bg-black/20 p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-[9px] tracking-[0.2em] text-emerald-300/40">EVENT {step + 1} / {selected.events.length}</p>
                  <h2 className="mt-2 text-2xl font-bold">第 {replayState.round} 局 · {replayPhaseNames[replayState.phase]}</h2>
                  <p className="mt-2 font-mono text-[10px] text-emerald-100/35">{formatReplayEvent(selected.events[step]?.event)}</p>
                </div>
                <button className={buttonClass} onClick={() => downloadRecord(repository, selected)}>匯出 JSON</button>
              </div>
              <input
                aria-label="重播事件位置"
                className="mt-8 w-full accent-emerald-300"
                type="range"
                min={0}
                max={Math.max(0, selected.events.length - 1)}
                value={step}
                onChange={(event) => setStep(Number(event.target.value))}
              />
              <div className="mt-6 grid grid-cols-2 gap-4">
                {(["human", "ai"] as const).map((player) => (
                  <div key={player} className="border border-emerald-300/10 p-4">
                    <p className="font-mono text-[10px] text-emerald-100/35">{player === "human" ? "YOU" : "AI"}</p>
                    <p className="mt-2 text-xl font-bold">{replayState.players[player].bios} BIOS</p>
                    <p className="mt-2 text-xs text-emerald-100/45">目標 {replayState.players[player].selectedTarget ?? "—"}</p>
                    <p className="mt-1 break-all font-mono text-[10px] text-emerald-100/35">鎖定：{replayState.players[player].lockedCards?.join(" · ") || "尚未鎖定"}</p>
                    <p className="mt-1 break-all font-mono text-[10px] text-cyan-100/40">組牌軌跡：{replayState.players[player].draft.join(" · ") || "空"}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </ScreenShell>
  );
}

function formatReplayEvent(event: MatchRecord["events"][number]["event"] | undefined): string {
  if (!event) return "UNKNOWN EVENT";
  if (event.type === "match-created") return "MATCH CREATED";
  if (event.type === "timer-paused") return "TIMER PAUSED";
  if (event.type === "timer-resumed") return "TIMER RESUMED";
  if (event.type === "phase-timeout") return `PHASE TIMEOUT · ${event.phase ?? "UNKNOWN"}`;
  if (event.type === "target-selected") return `${event.player.toUpperCase()} SELECTED TARGET ${event.target}`;
  if (event.type === "hand-locked") return `${event.player.toUpperCase()} LOCKED ${event.cardIds.join(" · ") || "INVALID EMPTY HAND"}`;
  if (event.type === "draft-changed") return `${event.player.toUpperCase()} DRAFT ${event.cardIds.join(" · ") || "CLEARED"}`;
  if (event.type === "candidate-saved") return `${event.player.toUpperCase()} SAVED CANDIDATE`;
  if (event.type === "candidate-selected") return `${event.player.toUpperCase()} SELECTED CANDIDATE ${event.index + 1}`;
  if (event.type === "betting-action" && "player" in event) {
    return `${event.player.toUpperCase()} ${event.action.toUpperCase()}${event.amount ? ` ${event.amount} BIOS` : ""}`;
  }
  return "UNKNOWN EVENT";
}

function ScreenShell({
  eyebrow,
  title,
  onExit,
  children,
}: {
  eyebrow: string;
  title: string;
  onExit: () => void;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-[#06110d] p-8 text-emerald-50">
      <div className="mx-auto max-w-6xl">
        <button className={buttonClass} onClick={onExit}>← 返回主選單</button>
        <header className="mb-8 mt-10">
          <p className="font-mono text-[10px] tracking-[0.28em] text-emerald-300/45">{eyebrow}</p>
          <h1 className="mt-2 text-4xl font-black">{title}</h1>
        </header>
        {children}
      </div>
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
