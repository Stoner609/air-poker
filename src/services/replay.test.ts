import { describe, expect, it } from "vitest";
import { NUMBER_PACKS } from "../content/number-packs";
import { createMatch, transition } from "../domain/game";
import type { RecordedEvent } from "./match-repository";
import { projectReplayStates } from "./replay";

describe("事件重播投影", () => {
  it("只靠初始狀態與精簡事件重建每一步狀態", () => {
    const initial = createMatch({ seed: 91, numberPack: NUMBER_PACKS[0] });
    const target = initial.players.human.targets[0];
    const event = { type: "target-selected" as const, player: "human" as const, target };
    const expected = transition(initial, event).state;
    const events: RecordedEvent[] = [
      { sequence: 0, at: 1, event: { type: "match-created" }, state: initial },
      { sequence: 1, at: 2, event },
      { sequence: 2, at: 3, event: { type: "timer-paused", phase: "number-selection" } },
    ];

    const states = projectReplayStates(events);

    expect(states[1]).toEqual(expected);
    expect(states[2]).toEqual(expected);
  });
});
