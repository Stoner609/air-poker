import type { GameState, PlayerId } from "../domain/game";
import type { RecordedEvent } from "./match-repository";
import { projectReplayStates } from "./replay";

export type BiosChipKind = "ante" | "bet" | "call" | "raise";
export type BiosChipStatus = "neutral" | "latest" | "completed";

export interface BiosChip {
  id: string;
  player: PlayerId;
  kind: BiosChipKind;
  amount: number;
  status: BiosChipStatus;
  sequence: number;
}

export interface BiosBettingLedgerPlayer {
  invested: number;
  chips: BiosChip[];
}

export interface BiosBettingLedger {
  round: number;
  players: Record<PlayerId, BiosBettingLedgerPlayer>;
}

export function projectCompletedBiosLedgers(
  events: RecordedEvent[],
  state: GameState,
): BiosBettingLedger[] {
  const completedRounds = new Set<number>();
  for (const replayState of projectReplayStates(events, state)) {
    for (const round of replayState?.history ?? []) completedRounds.add(round.round);
  }

  return [...completedRounds]
    .sort((left, right) => left - right)
    .map((round) => projectBiosBettingLedger(events, state, round));
}

export function projectBiosBettingLedger(
  events: RecordedEvent[],
  state: GameState,
  round = state.round,
): BiosBettingLedger {
  const replayStates = projectReplayStates(events, state);
  const players: Record<PlayerId, BiosBettingLedgerPlayer> = {
    human: {
      invested: 0,
      chips: [createChip(0, "human", "ante", round, "neutral")],
    },
    ai: {
      invested: 0,
      chips: [createChip(0, "ai", "ante", round, "neutral")],
    },
  };
  let latestChipId: string | undefined;
  let sawAction = false;

  events.forEach((record, index) => {
    const event = record.event;
    if (event.type !== "betting-action") return;

    const before = replayStates[index - 1];
    if (!before || before.round !== round || before.phase !== "betting") return;
    sawAction = true;

    const player = players[event.player];
    for (const chip of player.chips) {
      if (chip.kind !== "ante") chip.status = "completed";
    }
    latestChipId = undefined;

    const opponent: PlayerId = event.player === "human" ? "ai" : "human";
    const outstanding = Math.max(
      0,
      before.players[opponent].invested - before.players[event.player].invested,
    );

    if (event.action === "bet" && isPositiveInteger(event.amount)) {
      const chip = createChip(record.sequence, event.player, "bet", event.amount, "completed");
      player.chips.push(chip);
      latestChipId = chip.id;
    }

    if (event.action === "call" && outstanding > 0) {
      const chip = createChip(record.sequence, event.player, "call", outstanding, "completed");
      player.chips.push(chip);
      latestChipId = chip.id;
    }

    if (event.action === "raise" && outstanding > 0 && isPositiveInteger(event.amount)) {
      player.chips.push(
        createChip(record.sequence, event.player, "call", outstanding, "completed"),
      );
      const chip = createChip(record.sequence, event.player, "raise", event.amount, "completed");
      player.chips.push(chip);
      latestChipId = chip.id;
    }
  });

  if (round === state.round && state.phase === "betting" && latestChipId) {
    for (const player of Object.values(players)) {
      for (const chip of player.chips) {
        if (chip.id === latestChipId) chip.status = "latest";
      }
    }
  } else if (sawAction) {
    for (const player of Object.values(players)) {
      for (const chip of player.chips) chip.status = "completed";
    }
  }

  for (const player of Object.values(players)) {
    player.invested = player.chips.reduce((total, chip) => total + chip.amount, 0);
  }

  return { round, players };
}

function createChip(
  sequence: number,
  player: PlayerId,
  kind: BiosChipKind,
  amount: number,
  status: BiosChipStatus,
): BiosChip {
  return {
    id: `${sequence}:${player}:${kind}`,
    player,
    kind,
    amount,
    status,
    sequence,
  };
}

function isPositiveInteger(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
