import type { GameState, MatchPhase, PlayerId } from "./game";
import { seededUnit } from "./random";
import type { HandSolution } from "./solver";

export interface AiView {
  seed: number;
  round: number;
  phase: MatchPhase;
  pot: number;
  availableCardIds: string[];
  own: {
    bios: number;
    targets: number[];
    usedTargets: number[];
    selectedTarget?: number;
    invested: number;
  };
  opponent: {
    bios: number;
    invested: number;
    selectedTarget?: number;
  };
  currentActor?: PlayerId;
}

export function createAiView(state: GameState): AiView {
  const ai = state.players.ai;
  const human = state.players.human;
  return {
    seed: state.seed,
    round: state.round,
    phase: state.phase,
    pot: state.pot,
    availableCardIds: [...state.availableCardIds],
    own: {
      bios: ai.bios,
      targets: [...ai.targets],
      usedTargets: [...ai.usedTargets],
      selectedTarget: ai.selectedTarget,
      invested: ai.invested,
    },
    opponent: {
      bios: human.bios,
      invested: human.invested,
      selectedTarget: state.phase === "number-selection" ? undefined : human.selectedTarget,
    },
    currentActor: state.currentActor,
  };
}

export function chooseAiTarget(view: AiView): number {
  const remaining = view.own.targets.filter((target) => !view.own.usedTargets.includes(target));
  if (remaining.length === 1) return remaining[0];

  return [...remaining]
    .map((target, index) => {
      const straightPotential = target === 47 || target % 5 === 0 ? 1.8 : 0;
      const middleFlexibility = 1 - Math.abs(target - 35) / 35;
      const schedule = view.round >= 4 ? target / 64 : (64 - target) / 128;
      const noise = seededUnit(view.seed + view.round * 997 + index * 37) * 1.4;
      return { target, score: straightPotential + middleFlexibility + schedule + noise };
    })
    .sort((left, right) => right.score - left.score || left.target - right.target)[0].target;
}

export function chooseAiHand(view: AiView, solutions: HandSolution[]): HandSolution {
  if (solutions.length === 0) throw new Error("AI 沒有合法解");
  const roll = seededUnit(view.seed + view.round * 2039 + 17);
  if (roll < 0.68 || solutions.length === 1) return solutions[0];
  const candidateCount = Math.min(5, solutions.length);
  const index = 1 + Math.floor(seededUnit(view.seed + view.round * 4093 + 31) * (candidateCount - 1));
  return solutions[index];
}

export interface AiBettingAction {
  action: "check" | "fold" | "bet" | "call" | "raise";
  amount?: number;
}

export function chooseAiBettingAction(
  view: AiView,
  solution: HandSolution | undefined,
): AiBettingAction {
  const outstanding = Math.max(0, view.opponent.invested - view.own.invested);
  const categoryStrength = solution?.hand.strength[0] ?? -1;
  const roll = seededUnit(view.seed + view.round * 6151 + view.pot * 13);

  if (outstanding === 0) {
    const betMax = Math.min(
      Math.floor(view.pot / 2),
      view.own.bios,
      view.opponent.bios,
    );
    if (betMax >= 1 && (categoryStrength >= 4 || roll > 0.82)) {
      const fraction = categoryStrength >= 7 ? 1 : 0.45 + roll * 0.4;
      return { action: "bet", amount: Math.max(1, Math.floor(betMax * fraction)) };
    }
    return { action: "check" };
  }

  if (!solution && roll < 0.86) return { action: "fold" };
  const potAfterCall = view.pot + outstanding;
  const raiseMax = Math.min(
    Math.floor(potAfterCall / 2),
    Math.max(0, view.own.bios - outstanding),
    view.opponent.bios,
  );
  if (categoryStrength >= 7 && raiseMax >= 1 && roll > 0.35) {
    return { action: "raise", amount: Math.max(1, Math.floor(raiseMax * 0.7)) };
  }
  if (categoryStrength >= 2 || roll > 0.72) return { action: "call" };
  return { action: "fold" };
}
