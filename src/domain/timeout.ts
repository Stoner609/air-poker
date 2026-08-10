import { getBetLimits, type GameEvent, type GameState, type PlayerId } from "./game";
import { seededIndex } from "./random";

export function timeoutEventFor(state: GameState, player: PlayerId): GameEvent {
  if (state.phase === "number-selection") {
    const playerState = state.players[player];
    const remaining = playerState.targets.filter(
      (target) => !playerState.usedTargets.includes(target),
    );
    return {
      type: "target-selected",
      player,
      target: remaining[seededIndex(state.seed + state.round * 8191 + (player === "ai" ? 1 : 0), remaining.length)],
    };
  }

  if (state.phase === "construction" || state.phase === "correction") {
    const playerState = state.players[player];
    return {
      type: "hand-locked",
      player,
      cardIds: [...(playerState.lastCompleteCandidate ?? playerState.draft)],
    };
  }

  if (state.phase === "betting") {
    if (state.currentActor !== player) throw new Error("只有目前行動者會下注逾時");
    const { outstanding } = getBetLimits(state, player);
    return {
      type: "betting-action",
      player,
      action: outstanding > 0 ? "fold" : "check",
    };
  }

  throw new Error("目前階段沒有逾時行動");
}
