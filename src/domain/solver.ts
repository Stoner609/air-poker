import { compareHands, createDeck, evaluateSubmission, type PokerHand } from "./hand";

export interface SolverRequest {
  target: number;
  availableCardIds: string[];
  limit?: number;
}

export interface HandSolution {
  cardIds: string[];
  total: number;
  hand: PokerHand;
}

export function solveHands(request: SolverRequest): HandSolution[] {
  const available = new Set(request.availableCardIds);
  const cards = createDeck()
    .filter((card) => available.has(card.id))
    .sort((left, right) => left.value - right.value || left.id.localeCompare(right.id));
  const cardIds: string[] = [];
  const solutions: HandSolution[] = [];

  const search = (startIndex: number, total: number) => {
    const remaining = 5 - cardIds.length;
    if (remaining === 0) {
      if (total !== request.target) return;
      const result = evaluateSubmission({
        cardIds,
        target: request.target,
        availableCardIds: request.availableCardIds,
      });
      if (result.valid) {
        solutions.push({ cardIds: [...cardIds], total: result.total, hand: result.hand });
      }
      return;
    }

    if (cards.length - startIndex < remaining) return;
    let minimum = total;
    for (let offset = 0; offset < remaining; offset += 1) {
      minimum += cards[startIndex + offset].value;
    }
    if (minimum > request.target) return;

    let maximum = total;
    for (let offset = 0; offset < remaining; offset += 1) {
      maximum += cards[cards.length - 1 - offset].value;
    }
    if (maximum < request.target) return;

    for (let index = startIndex; index <= cards.length - remaining; index += 1) {
      const card = cards[index];
      if (total + card.value > request.target) break;
      cardIds.push(card.id);
      search(index + 1, total + card.value);
      cardIds.pop();
    }
  };

  search(0, 0);
  solutions.sort((left, right) => {
    const handOrder = compareHands(right.hand, left.hand);
    return handOrder || left.cardIds.join(",").localeCompare(right.cardIds.join(","));
  });
  return solutions.slice(0, request.limit ?? 100);
}
