// The Flip 7 deck (Normal Mode). 94 cards, exactly as in the project owner's rules document:
//   79 Number cards: one 0, one 1, two 2s ... twelve 12s
//    6 Score Modifier cards: +2 +4 +6 +8 +10 x2 (one each)
//    9 Action cards: 3 Freeze, 3 Flip Three, 3 Second Chance
import crypto from 'node:crypto';

export const ADD_MODIFIERS = [2, 4, 6, 8, 10];
export const ACTIONS = ['freeze', 'flip_three', 'second_chance'];

export function buildDeck() {
  const cards = [];
  let id = 0;
  const add = (card) => cards.push({ id: id++, ...card });

  add({ kind: 'number', value: 0 });
  for (let value = 1; value <= 12; value += 1) {
    for (let copy = 0; copy < value; copy += 1) add({ kind: 'number', value });
  }
  for (const amount of ADD_MODIFIERS) add({ kind: 'modifier', modifier: `+${amount}` });
  add({ kind: 'modifier', modifier: 'x2' });
  for (const action of ACTIONS) {
    for (let copy = 0; copy < 3; copy += 1) add({ kind: 'action', action });
  }
  return cards;
}

// A random number in [0, 1) from the operating system's secure generator, so nobody can
// predict the deck. (Tests pass their own generator to get repeatable shuffles.)
export const secureRandom = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

// Fisher-Yates shuffle, in place.
export function shuffle(cards, rng = secureRandom) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// Text for a card, shared by the event log and the tests: "7", "+4", "x2", "Freeze"...
export function cardLabel(card) {
  if (card.kind === 'number') return String(card.value);
  if (card.kind === 'modifier') return card.modifier;
  return { freeze: 'Freeze', flip_three: 'Flip Three', second_chance: 'Second Chance' }[card.action];
}
