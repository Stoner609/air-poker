import type { GameEvent, GameState, PlayerId } from "../domain/game";
import type { BiosBettingLedger, BiosChip, BiosChipKind } from "./bios-betting-ledger";
import type { RecordedEvent } from "./match-repository";

export type BiosBettingBeatKind = "ai-raise" | "settlement";
export type BiosBettingBeatStage = "call" | "settlement";

export interface BiosBettingBeat {
  kind: BiosBettingBeatKind;
  round: number;
  sequence: number;
  player: PlayerId;
  action: Extract<GameEvent, { type: "betting-action" }>["action"];
}

export function classifyBiosBettingBeat(
  event: RecordedEvent["event"],
  before: GameState | undefined,
  after: GameState | undefined,
  sequence: number,
): BiosBettingBeat | null {
  if (event.type !== "betting-action" || !before || !after || before.phase !== "betting") {
    return null;
  }

  if (after.history.length > before.history.length) {
    return {
      kind: "settlement",
      round: before.round,
      sequence,
      player: event.player,
      action: event.action,
    };
  }

  if (event.player === "ai" && event.action === "raise") {
    return {
      kind: "ai-raise",
      round: before.round,
      sequence,
      player: event.player,
      action: event.action,
    };
  }

  return null;
}

export function projectBiosBettingBeatLedger(
  ledger: BiosBettingLedger,
  beat: BiosBettingBeat,
  stage: BiosBettingBeatStage,
): BiosBettingLedger {
  if (beat.kind === "ai-raise" && stage === "call") {
    return {
      ...ledger,
      players: {
        ...ledger.players,
        ai: {
          ...ledger.players.ai,
          chips: ledger.players.ai.chips
            .filter((chip) => !(chip.sequence === beat.sequence && chip.kind === "raise"))
            .map((chip) =>
              chip.sequence === beat.sequence && chip.kind === "call"
                ? { ...chip, status: "latest" as const }
                : chip,
            ),
        },
      },
    };
  }

  const latestChip =
    beat.action === "call"
      ? { player: beat.player, sequence: beat.sequence, kind: "call" as const }
      : findLatestAction(ledger);
  const projectPlayer = (player: PlayerId) => ({
    ...ledger.players[player],
    chips: ledger.players[player].chips.map((chip) => ({
      ...chip,
      status:
        latestChip &&
        chip.player === latestChip.player &&
        chip.sequence === latestChip.sequence &&
        chip.kind === latestChip.kind
          ? "latest" as const
          : "completed" as const,
    })),
  });

  return {
    ...ledger,
    players: {
      human: projectPlayer("human"),
      ai: projectPlayer("ai"),
    },
  };
}

function findLatestAction(ledger: BiosBettingLedger): {
  player: PlayerId;
  sequence: number;
  kind: Exclude<BiosChipKind, "ante">;
} | null {
  const actions = Object.values(ledger.players).flatMap((player) =>
    player.chips.filter(
      (chip): chip is BiosChip & { kind: Exclude<BiosChipKind, "ante"> } => chip.kind !== "ante",
    ),
  );
  const chip = actions.reduce<typeof actions[number] | undefined>(
    (latest, current) =>
      !latest || current.sequence >= latest.sequence ? current : latest,
    undefined,
  );
  return chip ? { player: chip.player, sequence: chip.sequence, kind: chip.kind } : null;
}
