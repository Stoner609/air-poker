import type { PlayerId } from "../domain/game";
import type { BiosBettingLedgerPlayer, BiosChip } from "./bios-betting-ledger";

export type BiosBettingPreview =
  | { stage: "call"; callAmount: number }
  | { stage: "raise"; callAmount: number; raiseAmount: number }
  | { stage: "bet"; amount: number };

export type BiosPreviewMarker = "pending" | "pending-latest";

export type BiosDisplayChip = BiosChip & { preview?: BiosPreviewMarker };

export function biosPreviewContribution(preview: BiosBettingPreview): number {
  if (preview.stage === "bet") return preview.amount;
  if (preview.stage === "call") return preview.callAmount;
  return preview.callAmount + preview.raiseAmount;
}

export function projectBiosPreviewChips(
  player: PlayerId,
  ledgerPlayer: BiosBettingLedgerPlayer,
  preview: BiosBettingPreview | null,
): BiosDisplayChip[] {
  if (!preview) return ledgerPlayer.chips;

  const chips = ledgerPlayer.chips.map((chip) =>
    chip.status === "latest" ? { ...chip, status: "completed" as const } : chip,
  );
  const sequence = Math.max(...chips.map((chip) => chip.sequence), 0) + 1;
  const createPreviewChip = (
    kind: BiosChip["kind"],
    amount: number,
    marker: BiosPreviewMarker,
  ): BiosDisplayChip => ({
    id: `preview:${player}:${kind}`,
    player,
    kind,
    amount,
    status: "completed",
    sequence,
    preview: marker,
  });

  if (preview.stage === "bet") {
    return [...chips, createPreviewChip("bet", preview.amount, "pending-latest")];
  }
  if (preview.stage === "call") {
    return [...chips, createPreviewChip("call", preview.callAmount, "pending-latest")];
  }
  return [
    ...chips,
    createPreviewChip("call", preview.callAmount, "pending"),
    createPreviewChip("raise", preview.raiseAmount, "pending-latest"),
  ];
}

