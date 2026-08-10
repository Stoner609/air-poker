import type { GameEvent, GameState } from "../domain/game";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type RecordedEvent = {
  sequence: number;
  at: number;
  event:
    | GameEvent
    | { type: "match-created" }
    | { type: "timer-paused" | "timer-resumed" | "phase-timeout"; phase?: string };
  state?: GameState;
};

export interface MatchRecord {
  version: 1;
  state: GameState;
  events: RecordedEvent[];
  savedAt: number;
  timerKey?: string;
  timerRemaining?: number | null;
  openingInspectionComplete?: boolean;
  openingInspectionRemaining?: number;
  acknowledgedRounds?: number;
}

const ACTIVE_KEY = "air-poker:active-match:v1";
const COMPLETED_KEY = "air-poker:completed-matches:v1";

export class MatchRepository {
  constructor(private readonly storage: StorageLike) {}

  saveActive(record: MatchRecord): void {
    this.storage.setItem(ACTIVE_KEY, JSON.stringify(record));
  }

  loadActive(): MatchRecord | null {
    const value = this.storage.getItem(ACTIVE_KEY);
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as unknown;
      return isMatchRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  clearActive(): void {
    this.storage.removeItem(ACTIVE_KEY);
  }

  saveCompleted(record: MatchRecord): void {
    const records = [record, ...this.listCompleted().filter((item) => item.state.id !== record.state.id)]
      .sort((left, right) => right.savedAt - left.savedAt)
      .slice(0, 20);
    this.storage.setItem(COMPLETED_KEY, JSON.stringify(records));
  }

  listCompleted(): MatchRecord[] {
    const value = this.storage.getItem(COMPLETED_KEY);
    if (!value) return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isMatchRecord).sort((left, right) => right.savedAt - left.savedAt);
    } catch {
      return [];
    }
  }

  exportRecord(record: MatchRecord): string {
    return JSON.stringify(record, null, 2);
  }

  importRecord(json: string): MatchRecord {
    const parsed = JSON.parse(json) as unknown;
    if (!isMatchRecord(parsed)) throw new Error("不支援或損壞的 Air Poker 紀錄");
    this.saveCompleted(parsed);
    return parsed;
  }
}

function isMatchRecord(value: unknown): value is MatchRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MatchRecord>;
  const state = candidate.state;
  const human = state?.players?.human;
  const ai = state?.players?.ai;
  return (
    candidate.version === 1 &&
    state?.version === 1 &&
    typeof state.id === "string" &&
    typeof state.seed === "number" &&
    Array.isArray(state.availableCardIds) &&
    Array.isArray(state.history) &&
    Boolean(human) &&
    Array.isArray(human?.targets) &&
    Array.isArray(human?.usedTargets) &&
    Array.isArray(human?.draft) &&
    Boolean(ai) &&
    Array.isArray(ai?.targets) &&
    Array.isArray(ai?.usedTargets) &&
    Array.isArray(ai?.draft) &&
    Array.isArray(candidate.events) &&
    candidate.events.every(
      (event) =>
        Boolean(event) &&
        typeof event.sequence === "number" &&
        typeof event.at === "number" &&
        Boolean(event.event) &&
        typeof event.event.type === "string",
    ) &&
    typeof candidate.savedAt === "number"
  );
}
