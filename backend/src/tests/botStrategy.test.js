// How a computer player decides (game/botStrategy.js), shared by the server's bots and scripts/bots.js.
import { describe, it, expect } from 'vitest';
import { chooseMove } from '../game/botStrategy.js';

const seat = (id, extra = {}) => ({ id, numbers: [], roundScore: 0, hasSecondChance: false, ...extra });
const game = (decision, players) => ({ decision, players });

describe('chooseMove', () => {
  it('hits while the hand is small and cheap', () => {
    const g = game({ type: 'hit_or_stay', playerId: 1 }, [seat(1, { numbers: [3, 7], roundScore: 10 })]);
    expect(chooseMove(g, 1)).toEqual({ type: 'hit' });
  });

  it('stays at 5 number cards or 25 points', () => {
    expect(chooseMove(game({ type: 'hit_or_stay' }, [seat(1, { numbers: [1, 2, 3, 4, 5], roundScore: 15 })]), 1)).toEqual({ type: 'stay' });
    expect(chooseMove(game({ type: 'hit_or_stay' }, [seat(1, { numbers: [12, 11, 2], roundScore: 25 })]), 1)).toEqual({ type: 'stay' });
  });

  it('keeps hitting when a Second Chance covers the risk', () => {
    const g = game({ type: 'hit_or_stay' }, [seat(1, { numbers: [12, 11, 2], roundScore: 25, hasSecondChance: true })]);
    expect(chooseMove(g, 1)).toEqual({ type: 'hit' });
  });

  it('plays Freeze / Flip Three on the opponent with the best round, never itself when others can take it', () => {
    const g = game({ type: 'choose_target', options: [1, 2, 3] }, [seat(1, { roundScore: 40 }), seat(2, { roundScore: 5 }), seat(3, { roundScore: 20 })]);
    expect(chooseMove(g, 1)).toEqual({ type: 'target', targetId: 3 });
  });

  it('takes the card itself when it is the only choice', () => {
    expect(chooseMove(game({ type: 'choose_target', options: [1] }, [seat(1)]), 1)).toEqual({ type: 'target', targetId: 1 });
  });

  it('gives a spare Second Chance to the first player offered', () => {
    expect(chooseMove(game({ type: 'choose_gift', options: [4, 2] }, [seat(1)]), 1)).toEqual({ type: 'gift', targetId: 4 });
  });
});
