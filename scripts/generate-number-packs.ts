import { generateNumberPacks } from "../src/content/number-packs";
import { createDeck } from "../src/domain/hand";

const packs = generateNumberPacks(30);
const deck = new Map(createDeck().map((card) => [card.id, card]));

for (const pack of packs) {
  const baselineCards = pack.baselineHands.flat();
  const baselineTargets = pack.baselineHands.map((hand) =>
    hand.reduce((sum, id) => sum + deck.get(id)!.value, 0),
  );
  const expectedTargets = [...pack.playerTargets, ...pack.aiTargets];
  const allCards = [...baselineCards, ...pack.reserveCardIds];

  if (baselineCards.length !== 50 || new Set(baselineCards).size !== 50) {
    throw new Error(`${pack.id}: baseline must partition 50 unique cards`);
  }
  if (new Set(allCards).size !== 52) {
    throw new Error(`${pack.id}: baseline and reserve must cover the full deck`);
  }
  if (baselineTargets.some((target, index) => target !== expectedTargets[index])) {
    throw new Error(`${pack.id}: a baseline hand does not match its target`);
  }
  const targetTotal = expectedTargets.reduce((sum, target) => sum + target, 0);
  if (targetTotal < 348 || targetTotal > 358) {
    throw new Error(`${pack.id}: target total ${targetTotal} is outside 348–358`);
  }
}

process.stdout.write(`${JSON.stringify(packs, null, 2)}\n`);
process.stderr.write(`Validated ${packs.length} globally-solvable Air Poker number packs.\n`);
