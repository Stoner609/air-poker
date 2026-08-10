export const SUITS = ["S", "H", "D", "C"] as const;
export const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export interface Card {
  id: string;
  rank: Rank;
  suit: Suit;
  value: number;
}

export interface PokerHand {
  category:
    | "straight-flush"
    | "four-of-a-kind"
    | "full-house"
    | "flush"
    | "straight"
    | "three-of-a-kind"
    | "two-pair"
    | "pair"
    | "high-card";
  label: string;
  strength: number[];
}

export type SubmissionResult =
  | { valid: true; total: number; cards: Card[]; hand: PokerHand }
  | {
      valid: false;
      total: number;
      cards: Card[];
      reasons: Array<"card-count" | "duplicate-card" | "wrong-total" | "used-card">;
    };

const valueByRank = new Map<Rank, number>(
  RANKS.map((rank, index) => [rank, index + 1]),
);

const pokerRank = (value: number) => (value === 1 ? 14 : value);

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      id: `${suit}${rank}`,
      rank,
      suit,
      value: valueByRank.get(rank)!,
    })),
  );
}

export function compareHands(left: PokerHand, right: PokerHand): number {
  const length = Math.max(left.strength.length, right.strength.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.strength[index] ?? 0) - (right.strength[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function evaluateSubmission(input: {
  cardIds: string[];
  target: number;
  availableCardIds: string[];
}): SubmissionResult {
  const deckById = new Map(createDeck().map((card) => [card.id, card]));
  const cards = input.cardIds.flatMap((id) => {
    const card = deckById.get(id);
    return card ? [card] : [];
  });
  const total = cards.reduce((sum, card) => sum + card.value, 0);
  const reasons: Extract<SubmissionResult, { valid: false }>["reasons"] = [];

  if (input.cardIds.length !== 5 || cards.length !== 5) reasons.push("card-count");
  if (new Set(input.cardIds).size !== input.cardIds.length) reasons.push("duplicate-card");
  if (total !== input.target) reasons.push("wrong-total");

  const available = new Set(input.availableCardIds);
  if (input.cardIds.some((id) => !available.has(id))) reasons.push("used-card");

  if (reasons.length > 0) return { valid: false, total, cards, reasons };

  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  const groups = [...counts.entries()].sort(
    ([rankA, countA], [rankB, countB]) => countB - countA || rankB - rankA,
  );
  const values = [...counts.keys()].sort((a, b) => a - b);
  const royalValues = values.join(",") === "1,10,11,12,13";
  const isConsecutive =
    values.length === 5 && values.every((value, index) => index === 0 || value === values[index - 1] + 1);
  const straightHigh = royalValues ? 14 : isConsecutive ? values[4] : undefined;
  const isFlush = new Set(cards.map((card) => card.suit)).size === 1;
  const isFourOfAKind = groups[0]?.[1] === 4;
  const isFullHouse = groups[0]?.[1] === 3 && groups[1]?.[1] === 2;
  const isThreeOfAKind = groups[0]?.[1] === 3;
  const pairs = groups.filter(([, count]) => count === 2).map(([rank]) => rank).sort((a, b) => b - a);
  const highValues = cards
    .map((card) => (card.value === 1 ? 14 : card.value))
    .sort((a, b) => b - a);

  let hand: PokerHand;
  if (isFlush && straightHigh) {
    hand = { category: "straight-flush", label: "同花順", strength: [8, straightHigh] };
  } else if (isFourOfAKind) {
    hand = {
      category: "four-of-a-kind",
      label: "四條",
      strength: [7, pokerRank(groups[0][0]), pokerRank(groups[1][0])],
    };
  } else if (isFullHouse) {
    hand = {
      category: "full-house",
      label: "葫蘆",
      strength: [6, pokerRank(groups[0][0]), pokerRank(groups[1][0])],
    };
  } else if (isFlush) {
    hand = { category: "flush", label: "同花", strength: [5, ...highValues] };
  } else if (straightHigh) {
    hand = { category: "straight", label: "順子", strength: [4, straightHigh] };
  } else if (isThreeOfAKind) {
    hand = {
      category: "three-of-a-kind",
      label: "三條",
      strength: [
        3,
        pokerRank(groups[0][0]),
        ...groups
          .slice(1)
          .map(([rank]) => pokerRank(rank))
          .sort((a, b) => b - a),
      ],
    };
  } else if (pairs.length === 2) {
    const kicker = groups.find(([, count]) => count === 1)![0];
    hand = {
      category: "two-pair",
      label: "兩對",
      strength: [2, ...pairs.map(pokerRank).sort((a, b) => b - a), pokerRank(kicker)],
    };
  } else if (pairs.length === 1) {
    const kickers = groups
      .filter(([, count]) => count === 1)
      .map(([rank]) => (rank === 1 ? 14 : rank))
      .sort((a, b) => b - a);
    hand = { category: "pair", label: "一對", strength: [1, pokerRank(pairs[0]), ...kickers] };
  } else {
    hand = { category: "high-card", label: "高牌", strength: [0, ...highValues] };
  }

  return {
    valid: true,
    total,
    cards,
    hand,
  };
}
