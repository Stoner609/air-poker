import type { NumberPack } from "../domain/game";
import { createDeck } from "../domain/hand";

export interface ValidatedNumberPack extends NumberPack {
  reserveCardIds: [string, string];
  baselineHands: string[][];
}

const RESERVE_PAIRS: Array<[string, string]> = [
  ["SA", "S5"],
  ["HA", "S6"],
  ["DA", "S7"],
  ["CA", "S8"],
  ["S2", "H8"],
  ["H2", "D9"],
  ["D2", "C10"],
  ["C2", "SJ"],
  ["S3", "HQ"],
  ["H3", "DK"],
  ["D3", "CK"],
];

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const result = [...items];
  const random = mulberry32(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function generateNumberPacks(count: number): ValidatedNumberPack[] {
  const deck = createDeck();
  const deckById = new Map(deck.map((card) => [card.id, card]));
  const packs: ValidatedNumberPack[] = [];

  for (let packIndex = 0; packIndex < count; packIndex += 1) {
    const reserveCardIds = RESERVE_PAIRS[packIndex % RESERVE_PAIRS.length];
    const reserve = new Set(reserveCardIds);
    const available = deck.filter((card) => !reserve.has(card.id));
    let accepted: ValidatedNumberPack | undefined;

    for (let attempt = 0; attempt < 10_000 && !accepted; attempt += 1) {
      const cards = shuffled(available, 0xa17 + packIndex * 7919 + attempt * 104729);
      const baselineHands = Array.from({ length: 10 }, (_, index) =>
        cards.slice(index * 5, index * 5 + 5).map((card) => card.id),
      );
      const targets = baselineHands.map((hand) =>
        hand.reduce((sum, id) => sum + deckById.get(id)!.value, 0),
      );
      const playerTargets = targets.slice(0, 5);
      const aiTargets = targets.slice(5);
      if (new Set(playerTargets).size !== 5 || new Set(aiTargets).size !== 5) continue;

      accepted = {
        id: `pack-${String(packIndex + 1).padStart(2, "0")}`,
        playerTargets,
        aiTargets,
        reserveCardIds: [...reserveCardIds],
        baselineHands,
      };
    }

    if (!accepted) throw new Error(`Unable to generate number pack ${packIndex + 1}`);
    packs.push(accepted);
  }

  return packs;
}

export const NUMBER_PACKS = generateNumberPacks(30);
