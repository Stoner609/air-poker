import { transition, type GameEvent, type GameState } from "../domain/game";
import type { RecordedEvent } from "./match-repository";

const gameEventTypes = new Set<GameEvent["type"]>([
  "target-selected",
  "hand-locked",
  "draft-changed",
  "candidate-saved",
  "candidate-selected",
  "betting-action",
]);

export function projectReplayStates(
  events: RecordedEvent[],
  fallbackState?: GameState,
): Array<GameState | undefined> {
  let current: GameState | undefined;

  const states = events.map((record) => {
    if (record.event.type === "match-created") {
      current = record.state ? structuredClone(record.state) : current;
      return current;
    }

    if (record.state) {
      current = structuredClone(record.state);
      return current;
    }

    if (current && isGameEvent(record.event)) {
      current = transition(current, record.event).state;
    }
    return current;
  });

  if (states.length === 0 && fallbackState) return [fallbackState];
  return states;
}

function isGameEvent(event: RecordedEvent["event"]): event is GameEvent {
  return gameEventTypes.has(event.type as GameEvent["type"]);
}
