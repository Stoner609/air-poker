import { compareHands, createDeck, evaluateSubmission } from "./hand";

export type PlayerId = "human" | "ai";
export type MatchPhase =
  | "number-selection"
  | "construction"
  | "betting"
  | "correction"
  | "reveal"
  | "complete";

export interface NumberPack {
  id: string;
  playerTargets: number[];
  aiTargets: number[];
}

export interface PlayerMatchState {
  bios: number;
  targets: number[];
  usedTargets: number[];
  selectedTarget?: number;
  draft: string[];
  savedCandidates: string[][];
  lastCompleteCandidate?: string[];
  lockedCards?: string[];
  invested: number;
  folded: boolean;
}

export interface MatchSettings {
  timerPreset: "standard" | "relaxed" | "untimed";
  assisted: boolean;
}

export interface RoundRecord {
  round: number;
  outcome: "fold" | "showdown" | "single-valid" | "tie";
  winner?: PlayerId;
  targets: Record<PlayerId, number>;
  hands: Record<PlayerId, string[]>;
  pot: number;
  conflict: boolean;
  validity?: Record<PlayerId, boolean>;
  invalidReasons?: Partial<Record<PlayerId, string[]>>;
  handLabels?: Partial<Record<PlayerId, string>>;
  biosAfter?: Record<PlayerId, number>;
}

export interface GameState {
  version: 1;
  id: string;
  seed: number;
  numberPackId: string;
  settings: MatchSettings;
  round: number;
  phase: MatchPhase;
  pot: number;
  availableCardIds: string[];
  firstPlayer?: PlayerId;
  currentActor?: PlayerId;
  checksInRow: number;
  correctionAttempt: number;
  history: RoundRecord[];
  winner?: PlayerId | "tie";
  players: Record<PlayerId, PlayerMatchState>;
}

export type GameEvent =
  | {
      type: "target-selected";
      player: PlayerId;
      target: number;
    }
  | {
      type: "hand-locked";
      player: PlayerId;
      cardIds: string[];
    }
  | {
      type: "draft-changed";
      player: PlayerId;
      cardIds: string[];
    }
  | {
      type: "candidate-saved";
      player: PlayerId;
    }
  | {
      type: "candidate-selected";
      player: PlayerId;
      index: number;
    }
  | {
      type: "betting-action";
      player: PlayerId;
      action: "check" | "fold" | "bet" | "call" | "raise";
      amount?: number;
    };

export interface TransitionResult {
  state: GameState;
  effects: Array<{ type: string; message?: string }>;
}

export function getBetLimits(state: GameState, player: PlayerId) {
  const opponent = otherPlayer(player);
  const outstanding = Math.max(0, state.players[opponent].invested - state.players[player].invested);
  const betMax = Math.min(
    Math.floor(state.pot / 2),
    state.players[player].bios,
    state.players[opponent].bios,
  );
  const potAfterCall = state.pot + outstanding;
  const raiseMax = Math.min(
    Math.floor(potAfterCall / 2),
    Math.max(0, state.players[player].bios - outstanding),
    state.players[opponent].bios,
  );
  return { outstanding, betMax, raiseMax };
}

export function createMatch(input: {
  seed: number;
  numberPack: NumberPack;
  settings?: Partial<MatchSettings>;
}): GameState {
  const ante = 1;
  const createPlayer = (targets: number[]): PlayerMatchState => ({
    bios: 25 - ante,
    targets: [...targets],
    usedTargets: [],
    draft: [],
    savedCandidates: [],
    invested: ante,
    folded: false,
  });

  return {
    version: 1,
    id: `air-poker-${input.seed}`,
    seed: input.seed,
    numberPackId: input.numberPack.id,
    settings: {
      timerPreset: input.settings?.timerPreset ?? "standard",
      assisted: input.settings?.assisted ?? false,
    },
    round: 1,
    phase: "number-selection",
    pot: ante * 2,
    availableCardIds: createDeck().map((card) => card.id),
    checksInRow: 0,
    correctionAttempt: 0,
    history: [],
    players: {
      human: createPlayer(input.numberPack.playerTargets),
      ai: createPlayer(input.numberPack.aiTargets),
    },
  };
}

export function transition(state: GameState, event: GameEvent): TransitionResult {
  const next = structuredClone(state);

  if (event.type === "target-selected") {
    if (next.phase !== "number-selection") throw new Error("目前不能選擇目標數字");
    const player = next.players[event.player];
    if (!player.targets.includes(event.target) || player.usedTargets.includes(event.target)) {
      throw new Error("目標數字不可用");
    }
    player.selectedTarget = event.target;

    const humanTarget = next.players.human.selectedTarget;
    const aiTarget = next.players.ai.selectedTarget;
    if (humanTarget !== undefined && aiTarget !== undefined) {
      next.phase = "construction";
      if (next.round === 1) {
        next.firstPlayer =
          humanTarget === aiTarget
            ? next.seed % 2 === 0
              ? "human"
              : "ai"
            : humanTarget < aiTarget
              ? "human"
              : "ai";
      }
    }
  }

  if (event.type === "hand-locked") {
    if (next.phase !== "construction" && next.phase !== "correction") {
      throw new Error("目前不能鎖定牌組");
    }
    next.players[event.player].draft = [...event.cardIds];
    const target = next.players[event.player].selectedTarget;
    if (event.cardIds.length === 5 && target !== undefined) {
      const complete = evaluateSubmission({
        cardIds: event.cardIds,
        target,
        availableCardIds: createDeck().map((card) => card.id),
      });
      if (complete.valid) next.players[event.player].lastCompleteCandidate = [...event.cardIds];
    }
    next.players[event.player].lockedCards = [...event.cardIds];

    if (next.players.human.lockedCards && next.players.ai.lockedCards) {
      if (next.phase === "construction") {
        next.phase = "betting";
        next.currentActor = next.firstPlayer;
      } else {
        settleShowdown(next);
      }
    }
  }

  if (event.type === "draft-changed") {
    if (next.phase !== "construction" && next.phase !== "correction") {
      throw new Error("目前不能修改組牌槽");
    }
    if (event.cardIds.length > 5 || new Set(event.cardIds).size !== event.cardIds.length) {
      throw new Error("組牌槽必須包含最多五張不同的牌");
    }
    if (next.players[event.player].lockedCards) throw new Error("牌組已鎖定");
    next.players[event.player].draft = [...event.cardIds];
    const target = next.players[event.player].selectedTarget;
    if (event.cardIds.length === 5 && target !== undefined) {
      const complete = evaluateSubmission({
        cardIds: event.cardIds,
        target,
        availableCardIds: createDeck().map((card) => card.id),
      });
      if (complete.valid) next.players[event.player].lastCompleteCandidate = [...event.cardIds];
    }
  }

  if (event.type === "candidate-saved") {
    if (next.phase !== "construction" && next.phase !== "correction") {
      throw new Error("目前不能保存候選組合");
    }
    const player = next.players[event.player];
    if (player.draft.length !== 5) throw new Error("必須先選滿五張牌");
    const duplicate = player.savedCandidates.some(
      (candidate) => candidate.join(",") === player.draft.join(","),
    );
    if (!duplicate) player.savedCandidates = [...player.savedCandidates, [...player.draft]].slice(-3);
  }

  if (event.type === "candidate-selected") {
    if (next.phase !== "construction" && next.phase !== "correction") {
      throw new Error("目前不能切換候選組合");
    }
    const candidate = next.players[event.player].savedCandidates[event.index];
    if (!candidate) throw new Error("候選組合不存在");
    next.players[event.player].draft = [...candidate];
  }

  if (event.type === "betting-action") {
    if (next.phase !== "betting") throw new Error("目前不能下注");
    if (next.currentActor !== event.player) throw new Error("尚未輪到這位玩家");
    const opponent = otherPlayer(event.player);

    if (event.action === "fold") {
      settleFold(next, opponent);
    } else if (event.action === "check") {
      if (next.players[opponent].invested !== next.players[event.player].invested) {
        throw new Error("面對下注時不能過牌");
      }
      next.checksInRow += 1;
      if (next.checksInRow >= 2) settleShowdown(next);
      else next.currentActor = opponent;
    } else if (event.action === "bet") {
      const limits = getBetLimits(next, event.player);
      const amount = event.amount ?? 0;
      if (limits.outstanding > 0) throw new Error("面對下注時不能首次下注");
      if (!Number.isInteger(amount) || amount < 1 || amount > limits.betMax) {
        throw new Error(`下注上限為 ${limits.betMax} BIOS`);
      }
      next.players[event.player].bios -= amount;
      next.players[event.player].invested += amount;
      next.pot += amount;
      next.checksInRow = 0;
      next.currentActor = opponent;
    } else if (event.action === "call") {
      const limits = getBetLimits(next, event.player);
      if (limits.outstanding < 1) throw new Error("目前沒有可跟注的差額");
      if (limits.outstanding > next.players[event.player].bios) throw new Error("BIOS 不足");
      next.players[event.player].bios -= limits.outstanding;
      next.players[event.player].invested += limits.outstanding;
      next.pot += limits.outstanding;
      settleShowdown(next);
    } else if (event.action === "raise") {
      const limits = getBetLimits(next, event.player);
      const raiseBy = event.amount ?? 0;
      if (limits.outstanding < 1) throw new Error("目前沒有可再加注的下注");
      if (!Number.isInteger(raiseBy) || raiseBy < 1 || raiseBy > limits.raiseMax) {
        throw new Error(`加注上限為 ${limits.raiseMax} BIOS`);
      }
      const total = limits.outstanding + raiseBy;
      next.players[event.player].bios -= total;
      next.players[event.player].invested += total;
      next.pot += total;
      next.checksInRow = 0;
      next.currentActor = opponent;
    } else {
      throw new Error("尚未實作的下注行動");
    }
  }

  return { state: next, effects: [] };
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === "human" ? "ai" : "human";
}

function settleFold(state: GameState, winner: PlayerId): void {
  const loser = otherPlayer(winner);
  state.players[winner].bios += state.pot;
  state.players[loser].folded = true;

  const availableAtStart = [...state.availableCardIds];
  const human = evaluateSubmission({
    cardIds: state.players.human.lockedCards ?? [],
    target: state.players.human.selectedTarget!,
    availableCardIds: availableAtStart,
  });
  const ai = evaluateSubmission({
    cardIds: state.players.ai.lockedCards ?? [],
    target: state.players.ai.selectedTarget!,
    availableCardIds: availableAtStart,
  });

  const selectedCards = new Set([
    ...(state.players.human.lockedCards ?? []),
    ...(state.players.ai.lockedCards ?? []),
  ]);
  state.availableCardIds = state.availableCardIds.filter((id) => !selectedCards.has(id));

  const humanTarget = state.players.human.selectedTarget!;
  const aiTarget = state.players.ai.selectedTarget!;
  state.players.human.usedTargets.push(humanTarget);
  state.players.ai.usedTargets.push(aiTarget);
  state.history.push({
    round: state.round,
    outcome: "fold",
    winner,
    targets: { human: humanTarget, ai: aiTarget },
    hands: {
      human: [...(state.players.human.lockedCards ?? [])],
      ai: [...(state.players.ai.lockedCards ?? [])],
    },
    pot: state.pot,
    conflict: false,
    validity: { human: human.valid, ai: ai.valid },
    invalidReasons: {
      human: human.valid ? undefined : human.reasons,
      ai: ai.valid ? undefined : ai.reasons,
    },
    handLabels: {
      human: human.valid ? human.hand.label : undefined,
      ai: ai.valid ? ai.hand.label : undefined,
    },
    biosAfter: { human: state.players.human.bios, ai: state.players.ai.bios },
  });

  beginNextRound(state);
}

function settleShowdown(state: GameState): void {
  const availableAtStart = [...state.availableCardIds];
  const human = evaluateSubmission({
    cardIds: state.players.human.lockedCards ?? [],
    target: state.players.human.selectedTarget!,
    availableCardIds: availableAtStart,
  });
  const ai = evaluateSubmission({
    cardIds: state.players.ai.lockedCards ?? [],
    target: state.players.ai.selectedTarget!,
    availableCardIds: availableAtStart,
  });

  if (!human.valid && !ai.valid) {
    state.phase = "correction";
    state.currentActor = undefined;
    state.correctionAttempt += 1;
    for (const player of ["human", "ai"] as const) {
      state.players[player].draft = [];
      state.players[player].lockedCards = undefined;
    }
    return;
  }

  let winner: PlayerId | undefined;
  let outcome: RoundRecord["outcome"] = "showdown";
  if (human.valid && !ai.valid) {
    winner = "human";
    outcome = "single-valid";
  } else if (!human.valid && ai.valid) {
    winner = "ai";
    outcome = "single-valid";
  } else if (human.valid && ai.valid) {
    const comparison = compareHands(human.hand, ai.hand);
    if (comparison > 0) winner = "human";
    else if (comparison < 0) winner = "ai";
    else outcome = "tie";
  }

  const humanCards = state.players.human.lockedCards ?? [];
  const aiCards = state.players.ai.lockedCards ?? [];
  const overlap = human.valid && ai.valid && humanCards.some((id) => aiCards.includes(id));

  if (winner) state.players[winner].bios += state.pot;
  else {
    state.players.human.bios += state.pot / 2;
    state.players.ai.bios += state.pot / 2;
  }

  if (winner && overlap) {
    const loser = otherPlayer(winner);
    state.players[loser].bios = Math.max(0, state.players[loser].bios - state.round);
  }

  const selectedCards = new Set([...humanCards, ...aiCards]);
  state.availableCardIds = state.availableCardIds.filter((id) => !selectedCards.has(id));

  const humanTarget = state.players.human.selectedTarget!;
  const aiTarget = state.players.ai.selectedTarget!;
  state.players.human.usedTargets.push(humanTarget);
  state.players.ai.usedTargets.push(aiTarget);
  state.history.push({
    round: state.round,
    outcome,
    winner,
    targets: { human: humanTarget, ai: aiTarget },
    hands: { human: [...humanCards], ai: [...aiCards] },
    pot: state.pot,
    conflict: overlap,
    validity: { human: human.valid, ai: ai.valid },
    invalidReasons: {
      human: human.valid ? undefined : human.reasons,
      ai: ai.valid ? undefined : ai.reasons,
    },
    handLabels: {
      human: human.valid ? human.hand.label : undefined,
      ai: ai.valid ? ai.hand.label : undefined,
    },
    biosAfter: { human: state.players.human.bios, ai: state.players.ai.bios },
  });
  beginNextRound(state);
}

function beginNextRound(state: GameState): void {
  if (state.round >= 5) {
    state.phase = "complete";
    state.pot = 0;
    state.currentActor = undefined;
    state.winner =
      state.players.human.bios === state.players.ai.bios
        ? "tie"
        : state.players.human.bios > state.players.ai.bios
          ? "human"
          : "ai";
    return;
  }

  const nextRound = state.round + 1;
  const ante = nextRound;
  const unable = (["human", "ai"] as const).filter((player) => state.players[player].bios < ante);
  if (unable.length > 0) {
    state.phase = "complete";
    state.pot = 0;
    state.currentActor = undefined;
    if (unable.length === 1) state.winner = otherPlayer(unable[0]);
    else {
      state.winner =
        state.players.human.bios === state.players.ai.bios
          ? "tie"
          : state.players.human.bios > state.players.ai.bios
            ? "human"
            : "ai";
    }
    return;
  }

  const previousFirst = state.firstPlayer ?? "human";
  state.round = nextRound;
  state.phase = "number-selection";
  state.pot = ante * 2;
  state.firstPlayer = otherPlayer(previousFirst);
  state.currentActor = undefined;
  state.checksInRow = 0;
  state.correctionAttempt = 0;

  for (const player of ["human", "ai"] as const) {
    const playerState = state.players[player];
    playerState.bios -= ante;
    playerState.invested = ante;
    playerState.selectedTarget = undefined;
    playerState.draft = [];
    playerState.savedCandidates = [];
    playerState.lastCompleteCandidate = undefined;
    playerState.lockedCards = undefined;
    playerState.folded = false;
  }
}
