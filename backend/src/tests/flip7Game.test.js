// The rules engine, rule by rule. Each test stacks the deck so the cards come out in a known
// order. Shorthand: 'n7' = Number 7, '+4' / 'x2' = modifiers, F = Freeze, T = Flip Three,
// S = Second Chance. With players [1,2,3] and dealer index 0, the first three cards go to
// players 2, 3, 1 (dealer last) and player 2 acts first.
import { describe, it, expect } from 'vitest';
import { Game, STATUS } from '../game/flip7Game.js';
import { buildDeck } from '../game/deck.js';

const parse = (s) => {
  if (s.startsWith('n')) return { kind: 'number', value: Number(s.slice(1)) };
  if (s === 'x2' || s.startsWith('+')) return { kind: 'modifier', modifier: s };
  return { kind: 'action', action: { F: 'freeze', T: 'flip_three', S: 'second_chance' }[s] };
};
// An endless-feeling tail of harmless cards so a test never runs out of deck unexpectedly.
const filler = Array.from({ length: 40 }, (_, i) => `n${(i % 12) + 1}`);
function newGame(cards, { players = [1, 2, 3], dealer = 0, target = 200, pad = true, rng = () => 0.5 } = {}) {
  const deck = [...cards, ...(pad ? filler : [])].map((s, id) => ({ id, ...parse(s) }));
  const g = new Game({ playerIds: players, deck, dealerIndex: dealer, targetScore: target, rng });
  return autoDraw(g);
}
// The server's clock steps through Flip Three's one-card-at-a-time pauses; most tests skip them.
function autoDraw(g) {
  const settle = () => {
    while (g.decision?.type === 'flip_three_draw') rawTimeout.call(g);
  };
  const rawAct = g.act;
  const rawTimeout = g.timeout;
  const rawRemove = g.removePlayer;
  g.act = (...a) => [rawAct.apply(g, a), settle()][0];
  g.timeout = () => [rawTimeout.call(g), settle()][0];
  g.removePlayer = (...a) => [rawRemove.apply(g, a), settle()][0];
  settle();
  return g;
}
const hit = (g, id) => g.act(id, { type: 'hit' });
const stay = (g, id) => g.act(id, { type: 'stay' });
const target = (g, id, targetId) => g.act(id, { type: 'target', targetId });
const gift = (g, id, targetId) => g.act(id, { type: 'gift', targetId });
const p = (g, id) => g.view().players.find((x) => x.id === id);
const errorCode = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return null;
};
// Everybody stays, in turn order, until the round is over.
function everyoneStays(g) {
  while (g.phase === 'playing' && g.decision) stay(g, g.decision.playerId);
}

describe('the deck', () => {
  const deck = buildDeck();
  it('has 94 cards with unique ids', () => {
    expect(deck).toHaveLength(94);
    expect(new Set(deck.map((c) => c.id)).size).toBe(94);
  });
  it('has 79 number cards: one 0, one 1, two 2s ... twelve 12s', () => {
    const numbers = deck.filter((c) => c.kind === 'number');
    expect(numbers).toHaveLength(79);
    for (let v = 0; v <= 12; v += 1) expect(numbers.filter((c) => c.value === v)).toHaveLength(v === 0 ? 1 : v);
  });
  it('has the six score modifiers once each', () => {
    expect(deck.filter((c) => c.kind === 'modifier').map((c) => c.modifier).sort()).toEqual(['+10', '+2', '+4', '+6', '+8', 'x2']);
  });
  it('has 3 Freeze, 3 Flip Three and 3 Second Chance', () => {
    for (const a of ['freeze', 'flip_three', 'second_chance']) expect(deck.filter((c) => c.action === a)).toHaveLength(3);
  });
});

describe('setup and dealing', () => {
  it('deals one card to everyone, dealer last, and the player after the dealer goes first', () => {
    const g = newGame(['n5', 'n6', 'n7']);
    expect(p(g, 2).numbers).toEqual([5]);
    expect(p(g, 3).numbers).toEqual([6]);
    expect(p(g, 1).numbers).toEqual([7]);
    expect(g.decision).toMatchObject({ type: 'hit_or_stay', playerId: 2 });
    expect(g.view().dealerId).toBe(1);
  });

  it('reports only how many cards are left, never their order', () => {
    const g = new Game({ playerIds: [1, 2, 3] });
    const view = g.view();
    const dealt = view.players.reduce((n, pl) => n + pl.numbers.length + pl.modifiers.length + (pl.hasSecondChance ? 1 : 0), 0);
    expect(view.drawCount + dealt + view.discardCount).toBeLessThanOrEqual(94);
    expect(view.drawCount).toBeLessThan(94);
    expect(JSON.stringify(view)).not.toMatch(/drawPile|"deck"/);
  });

  it('needs at least two different players', () => {
    expect(() => new Game({ playerIds: [1] })).toThrow();
    expect(() => new Game({ playerIds: [1, 1, 2] })).toThrow();
  });

  it('pauses the deal when an Action card appears, resolves it, then continues', () => {
    // Player 2 is dealt Freeze first. Before anybody else gets a card, player 2 must choose.
    const g = newGame(['F', 'n6', 'n7', 'n8']);
    expect(g.decision).toMatchObject({ type: 'choose_target', playerId: 2, card: 'freeze', options: [1, 2, 3] });
    expect(p(g, 3).numbers).toEqual([]); // not dealt yet
    target(g, 2, 3); // freeze player 3 who has no card yet
    expect(p(g, 3).status).toBe(STATUS.FROZEN);
    // The deal continues: player 3 is frozen and skipped, player 1 (dealer) gets the next card.
    expect(p(g, 3).numbers).toEqual([]);
    expect(p(g, 1).numbers).toEqual([6]);
    expect(g.decision).toMatchObject({ type: 'hit_or_stay', playerId: 2 });
  });

  it('a Flip Three during the deal is played at once', () => {
    const g = newGame(['T', 'n6', 'n7', 'n1', 'n2', 'n3', 'n4']);
    expect(g.decision).toMatchObject({ type: 'choose_target', card: 'flip_three' });
    target(g, 2, 2); // on themselves: takes n6 n7 n1
    expect(p(g, 2).numbers).toEqual([6, 7, 1]);
    // the deal carries on with player 3 next
    expect(p(g, 3).numbers).toEqual([2]);
    expect(p(g, 1).numbers).toEqual([3]);
  });
});

describe('Hit and Stay', () => {
  it('Hit adds the card, and the turn passes on (no second hit in a row)', () => {
    const g = newGame(['n1', 'n2', 'n3', 'n9']);
    hit(g, 2);
    expect(p(g, 2).numbers).toEqual([1, 9]);
    expect(g.decision.playerId).toBe(3);
  });

  it('Stay secures the round score and the player takes no more turns', () => {
    const g = newGame(['n5', 'n6', 'n7']);
    stay(g, 2);
    expect(p(g, 2).status).toBe(STATUS.STAYED);
    stay(g, 3);
    expect(g.decision.playerId).toBe(1);
    hit(g, 1);
    expect(g.decision.playerId).toBe(1); // 2 and 3 are out, so player 1 keeps the table
  });

  it('only the player who is asked may answer', () => {
    const g = newGame(['n5', 'n6', 'n7']);
    expect(errorCode(() => hit(g, 3))).toBe('NOT_YOUR_TURN');
    expect(errorCode(() => hit(g, 99))).toBe('NOT_YOUR_TURN');
  });

  it('rejects answers that do not fit the question', () => {
    const g = newGame(['n5', 'n6', 'n7']);
    for (const bad of [null, undefined, 'hit', {}, { type: 'target', targetId: 1 }, { type: 'nope' }]) {
      expect(errorCode(() => g.act(2, bad))).toBe('INVALID_MOVE');
    }
  });

  it('refuses an answer to an older question (double click protection)', () => {
    const g = newGame(['n5', 'n6', 'n7', 'n8']);
    const id = g.decision.id;
    g.act(2, { type: 'stay', decisionId: id });
    expect(errorCode(() => g.act(3, { type: 'hit', decisionId: id }))).toBe('STALE_MOVE');
  });

  it('a lone active player can keep hitting; a second request is a new question', () => {
    const g = newGame(['n5', 'n6', 'n7', 'n1', 'n2']);
    stay(g, 2);
    stay(g, 3);
    const first = g.decision.id;
    g.act(1, { type: 'hit', decisionId: first });
    expect(errorCode(() => g.act(1, { type: 'hit', decisionId: first }))).toBe('STALE_MOVE');
    expect(p(g, 1).numbers).toEqual([7, 1]); // drawn exactly once
  });

  it('the round ends when nobody is active, scores are added to the totals', () => {
    const g = newGame(['n5', 'n6', 'n7']);
    everyoneStays(g);
    expect(g.phase).toBe('round_over');
    expect(g.lastRound.endReason).toBe('no_active_players');
    expect([1, 2, 3].map((id) => p(g, id).total)).toEqual([7, 5, 6]);
  });

  it('counts hits and busts for the match record', () => {
    const g = newGame(['n5', 'n6', 'n7', 'n5']);
    hit(g, 2); // busts
    stay(g, 3);
    stay(g, 1);
    g.beginNextRound();
    expect(g.players.find((x) => x.id === 2)).toMatchObject({ hits: 1, busts: 1 });
  });
});

describe('busting and Second Chance', () => {
  it('a duplicate number busts: round score is zero and the player is out', () => {
    const g = newGame(['n5', 'n6', 'n7', 'n5']);
    hit(g, 2);
    expect(p(g, 2)).toMatchObject({ status: STATUS.BUSTED, roundScore: 0 });
    expect(g.decision.playerId).toBe(3);
  });

  it('a different number is safe', () => {
    const g = newGame(['n7', 'n8', 'n9', 'n8']);
    hit(g, 2); // 7 then 8: fine
    expect(p(g, 2).status).toBe(STATUS.ACTIVE);
  });

  it('a bust does not remove points from earlier rounds', () => {
    // Round 1: p2 10, p3 6, p1 7. Round 2 (dealer p2): p3 n5, p1 n6, p2 n2; p3 and p1 stay, p2 busts.
    const g = newGame(['n10', 'n6', 'n7', 'n5', 'n6', 'n2', 'n2']);
    everyoneStays(g);
    expect(p(g, 2).total).toBe(10);
    g.beginNextRound();
    stay(g, 3);
    stay(g, 1);
    hit(g, 2);
    expect(p(g, 2)).toMatchObject({ status: STATUS.BUSTED, roundScore: 0, total: 10 });
  });

  it('a Second Chance is kept in front of the player until it is needed', () => {
    const g = newGame(['S', 'n6', 'n7', 'n1', 'n3', 'n4', 'n6']);
    expect(p(g, 2).hasSecondChance).toBe(true);
    hit(g, 2); hit(g, 3); hit(g, 1);
    hit(g, 2); // n6 is a new number for player 2: no duplicate, nothing used
    expect(p(g, 2)).toMatchObject({ numbers: [1, 6], hasSecondChance: true });
  });

  // Owner's rule (differs from the printed rulebook): the duplicate stays and counts.
  it('Second Chance saves a duplicate: only the Second Chance is discarded, the duplicate stays and counts', () => {
    const g = newGame(['S', 'n6', 'n7', 'n1', 'n2', 'n3', 'n1']);
    hit(g, 2); // n1
    hit(g, 3); // n2
    hit(g, 1); // n3
    const discardBefore = g.view().discardCount;
    hit(g, 2); // second n1: Second Chance saves them
    expect(p(g, 2)).toMatchObject({ status: STATUS.ACTIVE, hasSecondChance: false, numbers: [1, 1], savedIndexes: [1], bustCard: null, roundScore: 2 });
    expect(g.view().discardCount).toBe(discardBefore + 1); // only the Second Chance
    expect(g.events.some((e) => e.type === 'second_chance_used' && e.playerId === 2)).toBe(true);
    expect(g.decision.playerId).toBe(3); // no immediate extra turn
  });

  it('only protects once: the next duplicate busts', () => {
    const g = newGame(['S', 'n6', 'n7', 'n1', 'n2', 'n3', 'n1', 'n2', 'n3', 'n1']);
    hit(g, 2); hit(g, 3); hit(g, 1);
    hit(g, 2); // n1 saved
    hit(g, 3); hit(g, 1);
    hit(g, 2); // n1 again
    expect(p(g, 2).status).toBe(STATUS.BUSTED);
    expect(p(g, 2).bustCard).toBe(1);
  });

  it('a saved duplicate does not count towards Flip 7: seven DIFFERENT numbers are needed', () => {
    // Deal: 2 gets n1, 3 gets n7, 1 gets n8. Players 3 and 1 stay at once; only player 2 plays on.
    const g = newGame(['n1', 'n7', 'n8', 'S', 'n9', 'n10', 'n1', 'n11', 'n12', 'n2', 'n3']);
    hit(g, 2); // Second Chance
    stay(g, 3);
    stay(g, 1);
    hit(g, 2); // 9
    hit(g, 2); // 10
    hit(g, 2); // 1 again: saved, and it stays in the line
    expect(p(g, 2)).toMatchObject({ numbers: [1, 9, 10, 1], savedIndexes: [3], status: STATUS.ACTIVE });
    hit(g, 2); // 11
    hit(g, 2); // 12
    hit(g, 2); // 2: seven Number cards now, but only six different ones
    expect(p(g, 2).numbers).toHaveLength(7);
    expect(p(g, 2).flip7).toBe(false);
    hit(g, 2); // 3: the seventh DIFFERENT number
    expect(p(g, 2).flip7).toBe(true);
    // scoring counts the saved duplicate: 1+9+10+1+11+12+2+3 = 49, + 15 for Flip 7
    expect(g.lastRound.scores.find((s) => s.id === 2).roundScore).toBe(64);
  });

  it('Second Chance does not protect against a Freeze', () => {
    const g = newGame(['S', 'n6', 'n7', 'F']);
    hit(g, 2); // draws Freeze, player 2 chooses
    target(g, 2, 2);
    expect(p(g, 2).status).toBe(STATUS.FROZEN);
  });

  describe('a second Second Chance', () => {
    it('must be given to another active player who has none', () => {
      const g = newGame(['S', 'n6', 'n7', 'S']);
      hit(g, 2);
      expect(g.decision).toMatchObject({ type: 'choose_gift', playerId: 2, options: [1, 3] });
      gift(g, 2, 3);
      expect(p(g, 3).hasSecondChance).toBe(true);
      expect(p(g, 2).hasSecondChance).toBe(true);
    });

    it('cannot be given to someone who already has one or is out of the round', () => {
      const g = newGame(['S', 'S', 'n7', 'S']);
      stay(g, 2); // 2 holds S and stays? player 2 is out only after staying
      expect(g.decision.playerId).toBe(3);
      hit(g, 3); // 3 holds S, draws S
      expect(g.decision).toMatchObject({ type: 'choose_gift', options: [1] }); // 2 stayed, 3 is self
      expect(errorCode(() => gift(g, 3, 2))).toBe('INVALID_MOVE');
      gift(g, 3, 1);
      expect(p(g, 1).hasSecondChance).toBe(true);
    });

    it('is discarded when nobody can take it', () => {
      const g = newGame(['S', 'S', 'S', 'S']);
      hit(g, 2);
      expect(g.decision.type).toBe('hit_or_stay'); // no choice offered
      expect(g.events.some((e) => e.type === 'second_chance_discarded')).toBe(true);
    });

    it('is discarded if the holder runs out of time', () => {
      const g = newGame(['S', 'n6', 'n7', 'S']);
      hit(g, 2);
      g.timeout();
      expect(p(g, 1).hasSecondChance).toBe(false);
      expect(p(g, 3).hasSecondChance).toBe(false);
    });
  });

  it('unused Second Chance cards are discarded at the end of the round', () => {
    const g = newGame(['S', 'n6', 'n7']);
    everyoneStays(g);
    expect(g.phase).toBe('round_over');
    g.beginNextRound();
    expect(p(g, 2).hasSecondChance).toBe(false);
  });
});

describe('Freeze', () => {
  it('banks the target\'s points and takes them out of the round without a bust', () => {
    const g = newGame(['n5', 'n6', 'n7', 'F']);
    hit(g, 2); // draws Freeze
    expect(g.decision).toMatchObject({ type: 'choose_target', card: 'freeze', playerId: 2 });
    target(g, 2, 3);
    expect(p(g, 3)).toMatchObject({ status: STATUS.FROZEN, roundScore: 6 });
    expect(g.decision.playerId).toBe(1); // 3 is skipped
  });

  it('can be played on yourself', () => {
    const g = newGame(['n5', 'n6', 'n7', 'F']);
    hit(g, 2);
    target(g, 2, 2);
    expect(p(g, 2)).toMatchObject({ status: STATUS.FROZEN, roundScore: 5 });
  });

  it('must be played on yourself when you are the only active player', () => {
    const g = newGame(['n5', 'n6', 'n7', 'F']);
    stay(g, 2);
    stay(g, 3);
    hit(g, 1); // only player 1 is active
    expect(g.decision?.type).not.toBe('choose_target');
    expect(p(g, 1).status).toBe(STATUS.FROZEN);
  });

  it('cannot target an inactive player', () => {
    const g = newGame(['n5', 'n6', 'n7', 'F']);
    stay(g, 2);
    hit(g, 3); // draws Freeze: options are 1 and 3 only
    expect(g.decision.options).toEqual([1, 3]);
    expect(errorCode(() => target(g, 3, 2))).toBe('INVALID_MOVE');
  });

  describe('running out of time while choosing who gets a Freeze', () => {
    // Player 2 draws the Freeze; the options are players 1, 2 (the holder) and 3.
    const afk = (roll) => {
      const g = newGame(['n5', 'n6', 'n7', 'F'], { rng: () => roll });
      hit(g, 2);
      g.timeout();
      return g;
    };
    it('gives it to a random player: the roll picks the first, middle or last option', () => {
      expect(p(afk(0), 1).status).toBe(STATUS.FROZEN);
      expect(p(afk(0.5), 2).status).toBe(STATUS.FROZEN); // the holder can be picked
      expect(p(afk(0.99), 3).status).toBe(STATUS.FROZEN);
    });
    it('freezes exactly one player', () => {
      const g = afk(0);
      expect(g.view().players.filter((x) => x.status === STATUS.FROZEN)).toHaveLength(1);
    });
    it('a random Flip Three also lands on someone and is resolved', () => {
      const g = newGame(['n1', 'n2', 'n3', 'T', 'n4', 'n5', 'n6'], { rng: () => 0 });
      hit(g, 2);
      g.timeout(); // option 0 = player 1, who then draws 4, 5, 6
      expect(p(g, 1).numbers).toEqual([3, 4, 5, 6]);
    });
    it('never picks a player who has left', () => {
      const g = newGame(['n5', 'n6', 'n7', 'F'], { rng: () => 0, players: [1, 2, 3, 4] });
      // deal: p2 n5, p3 n6, p4 n7, p1 F? the Freeze is the 4th card here, held by dealer p1
      expect(g.decision).toMatchObject({ type: 'choose_target', playerId: 1 });
      g.removePlayer(2);
      g.timeout();
      expect(p(g, 2).status).toBe(STATUS.LEFT);
      expect(g.view().players.filter((x) => x.status === STATUS.FROZEN)).toHaveLength(1);
    });
  });
});

describe('Flip Three', () => {
  it('the target takes the next three cards, one at a time, all card types counting', () => {
    const g = newGame(['n1', 'n2', 'n3', 'T', 'n4', '+4', 'S']);
    stay(g, 2);
    stay(g, 3);
    hit(g, 1); // draws Flip Three (only player 1 active: auto-targets self)
    expect(p(g, 1).numbers).toEqual([3, 4]);
    expect(p(g, 1).modifiers).toEqual(['+4']);
    expect(p(g, 1).hasSecondChance).toBe(true);
  });

  it('the holder may choose another player', () => {
    const g = newGame(['n1', 'n2', 'n3', 'T', 'n4', 'n5', 'n6']);
    hit(g, 2);
    target(g, 2, 3);
    expect(p(g, 3).numbers).toEqual([2, 4, 5, 6]);
    expect(p(g, 2).numbers).toEqual([1]);
  });

  it('stops immediately if the target busts: the remaining cards are not drawn', () => {
    const g = newGame(['n1', 'n2', 'n3', 'T', 'n2', 'n9', 'n8']);
    hit(g, 2); // draws Flip Three
    target(g, 2, 3); // player 3 already holds 2 and draws another 2: bust after one card
    expect(p(g, 3)).toMatchObject({ status: STATUS.BUSTED, numbers: [2], roundScore: 0, bustCard: 2 });
    expect(p(g, 2).bustCard).toBeNull(); // only the busted hand reports one
    expect(g.decision.playerId).toBe(1); // the busted player is skipped
    expect(g.events.find((e) => e.type === 'flip_three_stopped')).toMatchObject({ playerId: 3, remaining: 2 });
    hit(g, 1);
    expect(p(g, 1).numbers).toEqual([3, 9]); // n9 was never drawn by the bust
  });

  it('deals the three cards one at a time, pausing before each, and a bust leaves the rest in the deck', () => {
    const deck = ['n1', 'n2', 'n3', 'T', 'n4', 'n2', 'n9', ...filler].map((s, id) => ({ id, ...parse(s) }));
    const g = new Game({ playerIds: [1, 2, 3], deck, dealerIndex: 0, rng: () => 0.5 });
    hit(g, 2);
    target(g, 2, 3);
    expect(g.decision).toMatchObject({ type: 'flip_three_draw', playerId: 3, options: [1] });
    expect(p(g, 3).numbers).toEqual([2]); // nothing drawn yet
    expect(errorCode(() => g.act(3, { type: 'hit' }))).toBe('NOTHING_TO_DO'); // nobody can skip the pause
    g.timeout();
    expect(p(g, 3).numbers).toEqual([2, 4]);
    expect(g.decision).toMatchObject({ type: 'flip_three_draw', options: [2] });
    const left = g.view().drawCount;
    g.timeout(); // n2: bust
    expect(p(g, 3).status).toBe(STATUS.BUSTED);
    expect(g.view().drawCount).toBe(left - 1); // n9 was not drawn
    expect(g.decision).toMatchObject({ type: 'hit_or_stay', playerId: 1 });
    hit(g, 1);
    expect(p(g, 1).numbers).toEqual([3, 9]); // the next card off the deck is the one Flip Three left
  });

  it('a Second Chance drawn during it can be kept, then used by a later card', () => {
    const g = newGame(['n1', 'n2', 'n3', 'T', 'S', 'n2', 'n9']);
    hit(g, 2);
    target(g, 2, 3);
    expect(p(g, 3)).toMatchObject({ status: STATUS.ACTIVE, hasSecondChance: false, numbers: [2, 2, 9], savedIndexes: [1] });
  });

  it('a Freeze drawn during it waits until all three cards are drawn, then the drawer chooses', () => {
    const g = newGame(['n1', 'n2', 'n3', 'T', 'F', 'n5', 'n6']);
    hit(g, 2);
    target(g, 2, 3); // 3 draws Freeze (set aside), 5, 6
    expect(p(g, 3).numbers).toEqual([2, 5, 6]);
    expect(g.decision).toMatchObject({ type: 'choose_target', playerId: 3, card: 'freeze' });
    target(g, 3, 1);
    expect(p(g, 1).status).toBe(STATUS.FROZEN);
  });

  it('a set-aside Freeze is lost if the target busts', () => {
    const g = newGame(['n1', 'n2', 'n3', 'T', 'F', 'n2', 'n6']);
    hit(g, 2);
    target(g, 2, 3);
    expect(p(g, 3).status).toBe(STATUS.BUSTED);
    expect(g.decision?.type).toBe('hit_or_stay'); // no pending choose_target
  });

  it('a Flip Three drawn during a Flip Three is played afterwards, as a new sequence', () => {
    const g = newGame(['n1', 'n2', 'n3', 'T', 'T', 'n4', 'n5', 'n6', 'n7', 'n8']);
    hit(g, 2);
    target(g, 2, 3);
    // 3 drew T, 4, 5 -> then chooses who takes the next three
    expect(p(g, 3).numbers).toEqual([2, 4, 5]);
    expect(g.decision).toMatchObject({ type: 'choose_target', playerId: 3, card: 'flip_three' });
    target(g, 3, 3);
    expect(p(g, 3).numbers).toEqual([2, 4, 5, 6, 7, 8]);
  });
});

describe('score modifiers and scoring', () => {
  it('reproduces the rulebook example: 3+5+8+11, x2, +4, +8 = 66', () => {
    // Deal: p2 n3, p3 n1, p1 n2. Player 2 draws +4, then the others stay, then n5 +8 n8 x2 n11.
    const g = newGame(['n3', 'n1', 'n2', '+4', 'n5', '+8', 'n8', 'x2', 'n11']);
    hit(g, 2);
    stay(g, 3);
    stay(g, 1);
    for (let i = 0; i < 5; i += 1) hit(g, 2);
    expect(p(g, 2).numbers).toEqual([3, 5, 8, 11]);
    expect(p(g, 2).roundScore).toBe(66);
  });

  it('scoreHand: (sum x multiplier) + additions + bonus; a bust or a leaver scores 0', () => {
    const base = { numbers: [3, 5, 8, 11], mods: [{ modifier: 'x2' }, { modifier: '+4' }, { modifier: '+8' }] };
    expect(Game.scoreHand({ ...base, status: STATUS.STAYED, flip7: false })).toBe(66);
    expect(Game.scoreHand({ ...base, status: STATUS.STAYED, flip7: true })).toBe(81);
    expect(Game.scoreHand({ ...base, status: STATUS.BUSTED, flip7: false })).toBe(0);
    expect(Game.scoreHand({ ...base, status: STATUS.LEFT, flip7: false })).toBe(0);
  });

  it('a + card scores without number cards, and x2 alone scores zero', () => {
    expect(Game.scoreHand({ status: STATUS.STAYED, numbers: [], mods: [{ modifier: '+6' }], flip7: false })).toBe(6);
    expect(Game.scoreHand({ status: STATUS.STAYED, numbers: [], mods: [{ modifier: 'x2' }], flip7: false })).toBe(0);
  });

  it('modifiers never bust a player', () => {
    // player 2 holds 1; draws +4 then another +4-style card: still active, never a bust
    const g = newGame(['n1', 'n2', 'n3', '+4', '+2']);
    hit(g, 2); // +4
    hit(g, 3); // +2
    expect(p(g, 2)).toMatchObject({ status: STATUS.ACTIVE, modifiers: ['+4'] });
    expect(p(g, 3)).toMatchObject({ status: STATUS.ACTIVE, modifiers: ['+2'] });
  });
});

describe('Flip 7', () => {
  // Two players: p2 is dealt first and acts first; p1 is the dealer.
  it('seven different numbers end the round at once: +15 for the achiever, others score as usual', () => {
    const g = newGame(['n1', 'n9', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'], { players: [1, 2], pad: false });
    hit(g, 2); // n2
    stay(g, 1); // 9 points secured
    for (let i = 0; i < 5; i += 1) hit(g, 2); // n3..n7
    expect(g.phase).toBe('round_over');
    expect(g.lastRound.endReason).toBe('flip7');
    expect(p(g, 2)).toMatchObject({ flip7: true, roundScore: 28 + 15, total: 43 });
    expect(p(g, 1).total).toBe(9);
  });

  it('x2 doubles the numbers but not the +15 bonus', () => {
    const g = newGame(['n1', 'n9', 'n2', 'x2', 'n3', 'n4', 'n5', 'n6', 'n7'], { players: [1, 2], pad: false });
    hit(g, 2);
    stay(g, 1);
    for (let i = 0; i < 6; i += 1) hit(g, 2);
    expect(p(g, 2).total).toBe(28 * 2 + 15);
  });

  it('counts the 0 card as a different number', () => {
    const g = newGame(['n0', 'n9', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'], { players: [1, 2], pad: false });
    hit(g, 2);
    stay(g, 1);
    for (let i = 0; i < 5; i += 1) hit(g, 2);
    expect(g.lastRound.endReason).toBe('flip7');
    expect(p(g, 2).total).toBe(21 + 15);
  });

  it('modifiers and action cards do not count towards the seven', () => {
    const g = newGame(['n1', 'n9', 'n2', '+4', 'x2', 'n3', 'n4', 'n5', 'n6'], { players: [1, 2], pad: false });
    hit(g, 2);
    stay(g, 1);
    for (let i = 0; i < 5; i += 1) hit(g, 2); // +4 x2 n3 n4 n5: numbers 1,2,3,4,5 only
    expect(g.phase).toBe('playing');
    expect(p(g, 2).flip7).toBe(false);
  });

  it('a busted player scores zero and a staying player keeps their score when Flip 7 ends the round', () => {
    const g = newGame(['n1', 'n9', 'n9', 'n2', 'n9', 'n3', 'n4', 'n5', 'n6', 'n7'], { players: [1, 2, 3], pad: false });
    hit(g, 2); // n2
    hit(g, 3); // n9 duplicate: bust
    stay(g, 1); // 9
    for (let i = 0; i < 5; i += 1) hit(g, 2);
    expect(g.lastRound.endReason).toBe('flip7');
    expect(p(g, 3)).toMatchObject({ status: STATUS.BUSTED, total: 0 });
    expect(p(g, 1).total).toBe(9);
    expect(p(g, 2).total).toBe(43);
  });

  it('an active player who has not stayed still scores their cards when someone else flips 7', () => {
    const deck = ['n1', 'n8', 'n2', 'n3', 'n4', 'n5', 'n6', 'n9', 'n7', 'n12', 'n10', 'n0', 'n11'];
    const g = newGame(deck, { players: [1, 2], pad: false });
    for (let i = 0; i < 11; i += 1) hit(g, i % 2 === 0 ? 2 : 1); // 2,1,2,1,... player 2 completes 1,2,4,6,7,10,11
    expect(g.lastRound.endReason).toBe('flip7');
    expect(p(g, 1).status).toBe(STATUS.ACTIVE); // never stayed
    expect(p(g, 1).total).toBe(8 + 3 + 5 + 9 + 12 + 0);
    expect(p(g, 2).total).toBe(1 + 2 + 4 + 6 + 7 + 10 + 11 + 15);
  });

  it('happens in the middle of a Flip Three: the round ends and the third card is not drawn', () => {
    const g = newGame(['n1', 'n9', 'n2', 'n3', 'n4', 'n5', 'T', 'n6', 'n7', 'n8'], { players: [1, 2], pad: false });
    hit(g, 2); // n2
    stay(g, 1);
    hit(g, 2); hit(g, 2); hit(g, 2); // n3 n4 n5
    hit(g, 2); // draws Flip Three: p2 is the only active player, so it is played on them: n6 n7 -> Flip 7
    expect(g.phase).toBe('round_over');
    expect(g.lastRound.endReason).toBe('flip7');
    expect(p(g, 2).numbers).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(g.view().drawCount).toBe(1); // n8 is still in the deck
  });

  it('a Freeze set aside by a Flip Three is thrown away when Flip 7 ends the round', () => {
    const g = newGame(['n1', 'n9', 'n2', 'n3', 'n4', 'n5', 'T', 'F', 'n6', 'n7'], { players: [1, 2], pad: false });
    hit(g, 2);
    stay(g, 1);
    for (let i = 0; i < 4; i += 1) hit(g, 2);
    expect(g.phase).toBe('round_over');
    expect(g.decision).toBeNull();
    expect(p(g, 1).status).toBe(STATUS.STAYED); // the Freeze never got to be played
  });
});

describe('rounds and the end of the game', () => {
  it('the dealer role passes to the next player and a new round deals again', () => {
    const g = newGame(['n5', 'n6', 'n7']);
    everyoneStays(g);
    expect(g.view().dealerId).toBe(1);
    g.beginNextRound();
    expect(g.view().dealerId).toBe(2);
    expect(g.view().roundNumber).toBe(2);
    expect(g.phase).toBe('playing');
    expect(g.decision).toMatchObject({ type: 'hit_or_stay', playerId: 3 }); // left of the new dealer (player 2)
  });

  it('cannot start the next round before the round is over', () => {
    const g = newGame(['n5', 'n6', 'n7']);
    expect(errorCode(() => g.beginNextRound())).toBe('ROUND_NOT_OVER');
  });

  it('keeps totals between rounds and uses the remaining deck (not a fresh one)', () => {
    const g = newGame(['n5', 'n6', 'n7', 'n1', 'n2', 'n3']);
    everyoneStays(g);
    const left = g.view().drawCount;
    g.beginNextRound();
    expect(g.view().drawCount).toBeLessThan(left);
    expect([1, 2, 3].map((id) => p(g, id).total)).toEqual([7, 5, 6]);
  });

  it('ends when a player reaches 200 after the round is scored, with the highest score winning', () => {
    const g = newGame(['n12', 'n11', 'n10'], { target: 11 });
    everyoneStays(g); // totals: p1 10, p2 12, p3 11
    expect(g.phase).toBe('finished');
    expect(g.result).toMatchObject({ reason: 'target_reached', winnerIds: [2], rounds: 1 });
    expect(g.result.standings.map((x) => x.userId)).toEqual([2, 3, 1]);
    expect(g.result.standings.map((x) => x.rankingPoints)).toEqual([12, 11, 10]);
  });

  it('does not stop in the middle of a round when someone crosses the line', () => {
    const g = newGame(['n12', 'n6', 'n5', 'n10', 'n9'], { target: 12 });
    // p2 holds 12 already (>= target) but the round is still running until everyone is done
    stay(g, 2);
    expect(g.phase).toBe('playing');
    stay(g, 3);
    expect(g.phase).toBe('playing');
    stay(g, 1);
    expect(g.phase).toBe('finished');
  });

  it('a tie at the top above the target means extra rounds until there is one winner', () => {
    // Round 1: p2 12, p3 12, p1 5 (target 10): tie at the top.
    const g = newGame(['n12', 'n12', 'n5', /* round 2 */ 'n9', 'n1', 'n1'], { target: 10 });
    everyoneStays(g);
    expect(g.phase).toBe('round_over');
    expect(g.result).toBeNull();
    g.beginNextRound(); // dealer is now p2: deal order p3, p1, p2
    everyoneStays(g);
    expect(g.phase).toBe('finished');
    expect(g.result.winnerIds).toHaveLength(1);
  });

  it('nobody has to be ahead by anything: a tied top score below the target just continues', () => {
    const g = newGame(['n5', 'n5', 'n1'], { target: 100 });
    everyoneStays(g);
    expect(g.phase).toBe('round_over');
  });

  it('shuffles the discard pile into a new draw pile when the deck runs out (cards in front stay put)', () => {
    const g = newGame(['n1', 'n2', 'n3'], { pad: false }); // exactly three cards, then nothing
    everyoneStays(g);
    expect(g.view().drawCount).toBe(0);
    expect(g.view().discardCount).toBe(3);
    g.beginNextRound(); // draw pile empty: the three discarded cards form the new deck
    expect(g.events.some((e) => e.type === 'deck_reshuffled')).toBe(true);
    expect(g.view().players.reduce((n, pl) => n + pl.numbers.length, 0)).toBe(3);
  });

  it('a round with nothing left to draw ends instead of hanging', () => {
    const g = newGame(['n1', 'n2'], { pad: false });
    expect(g.phase).toBe('round_over');
    expect(g.lastRound.endReason).toBe('deck_empty');
  });
});

describe('time limits', () => {
  it('running out of time on Hit/Stay is an automatic Stay', () => {
    const g = newGame(['n5', 'n6', 'n7']);
    g.timeout();
    expect(p(g, 2).status).toBe(STATUS.STAYED);
    expect(g.decision.playerId).toBe(3);
  });

  it('a time-out when nothing is pending does nothing', () => {
    const g = newGame(['n5', 'n6', 'n7'], { target: 1 });
    everyoneStays(g);
    expect(g.finished).toBe(true);
    expect(g.timeout()).toEqual([]);
  });
});

describe('leaving the match', () => {
  it('a leaver is out of the round, scores nothing and gets 0 in the result', () => {
    const g = newGame(['n5', 'n6', 'n7'], { target: 6 });
    g.removePlayer(3);
    expect(p(g, 3)).toMatchObject({ left: true, status: STATUS.LEFT, roundScore: 0 });
    everyoneStays(g);
    expect(g.finished).toBe(true);
    const row = g.result.standings.find((x) => x.userId === 3);
    expect(row).toMatchObject({ finalPoints: 0, rankingPoints: 0, left: true });
    expect(g.result.winnerIds).not.toContain(3);
  });

  it('their turn is skipped when they leave while it is their move', () => {
    const g = newGame(['n5', 'n6', 'n7']);
    g.removePlayer(2); // it was player 2's turn
    expect(g.decision.playerId).toBe(3);
  });

  it('a Second Chance they held goes to the discard pile', () => {
    const g = newGame(['S', 'n6', 'n7']);
    const before = g.view().discardCount;
    g.removePlayer(2);
    expect(g.view().discardCount).toBe(before + 1);
  });

  it('a pending card choice by the leaver is settled automatically', () => {
    const g = newGame(['n1', 'n2', 'n3', 'F']);
    hit(g, 2);
    expect(g.decision.type).toBe('choose_target');
    g.removePlayer(2);
    expect(g.decision?.type).toBe('hit_or_stay');
    expect(g.decision.playerId).not.toBe(2);
  });

  it('when only one player is left they win, with the points from completed rounds', () => {
    const g = newGame(['n5', 'n6', 'n7', 'n1', 'n2', 'n3']);
    everyoneStays(g); // round 1: p1 7, p2 5, p3 6
    g.beginNextRound();
    g.removePlayer(2);
    g.removePlayer(3);
    expect(g.finished).toBe(true);
    expect(g.result).toMatchObject({ reason: 'last_player', winnerIds: [1] });
    const byUser = Object.fromEntries(g.result.standings.map((x) => [x.userId, x]));
    expect(byUser[1].finalPoints).toBe(7); // the unfinished round is not scored
    expect(byUser[2]).toMatchObject({ finalPoints: 0, left: true });
    expect(byUser[3]).toMatchObject({ finalPoints: 0, left: true });
    expect(g.decision).toBeNull();
  });

  it('a player the host removed keeps the points they had banked, but cannot win', () => {
    const g = newGame(['n5', 'n6', 'n7', 'n1', 'n2', 'n3'], { target: 12 });
    everyoneStays(g); // round 1: p1 7, p2 5, p3 6
    g.beginNextRound();
    g.removePlayer(1, { keepPoints: true }); // the leader is kicked
    g.removePlayer(3);
    expect(g.result.winnerIds).toEqual([2]);
    expect(g.result.standings.map((x) => x.userId)).toEqual([2, 1, 3]); // the winner is listed first, even with fewer points
    const byUser = Object.fromEntries(g.result.standings.map((x) => [x.userId, x]));
    expect(byUser[1]).toMatchObject({ finalPoints: 7, rankingPoints: 7, left: true });
    expect(byUser[3]).toMatchObject({ finalPoints: 0, rankingPoints: 0, left: true });
  });

  it('every player who took part appears in the result, including leavers', () => {
    const g = newGame(['n5', 'n6', 'n7']);
    g.removePlayer(1);
    g.removePlayer(2);
    expect(g.result.standings.map((x) => x.userId).sort()).toEqual([1, 2, 3]);
  });

  it('leaving between rounds can decide a tie for the lead', () => {
    const g = newGame(['n12', 'n12', 'n5'], { target: 10 });
    everyoneStays(g); // p2 and p3 tied on 12
    expect(g.phase).toBe('round_over');
    g.removePlayer(3);
    expect(g.finished).toBe(true);
    expect(g.result.winnerIds).toEqual([2]);
  });

  it('removing someone twice or after the end changes nothing', () => {
    const g = newGame(['n5', 'n6', 'n7']);
    g.removePlayer(3);
    expect(g.removePlayer(3)).toEqual([]);
    g.removePlayer(2);
    expect(g.removePlayer(1)).toEqual([]);
  });

  it('a leaver is not dealt cards in later rounds', () => {
    const g = newGame(['n5', 'n6', 'n7', 'n1', 'n2']);
    g.removePlayer(3);
    everyoneStays(g);
    g.beginNextRound();
    expect(p(g, 3)).toMatchObject({ status: STATUS.LEFT, numbers: [] });
  });

  it('a player who left can no longer be chosen for a card', () => {
    const g = newGame(['n1', 'n2', 'F'], { players: [1, 2, 3, 4] }); // player 4 is dealt the Freeze
    expect(g.decision).toMatchObject({ type: 'choose_target', playerId: 4, options: [1, 2, 3, 4] });
    g.removePlayer(3);
    expect(g.decision.options).toEqual([1, 2, 4]);
    expect(errorCode(() => target(g, 4, 3))).toBe('INVALID_MOVE');
    expect(g.decision.type).toBe('choose_target'); // the card is still waiting for a real choice
  });

  it('when the leaver was the only other choice, the holder must take the card', () => {
    const g = newGame(['n1', 'n2', 'n3', 'F']);
    stay(g, 2);
    hit(g, 3); // draws the Freeze: player 1 or themselves
    expect(g.decision).toMatchObject({ type: 'choose_target', playerId: 3, options: [1, 3] });
    g.removePlayer(1);
    expect(g.hand(3).status).toBe(STATUS.FROZEN);
  });

  // Game.prototype.* = without the test helper that draws all three cards at once.
  it('leaving in the middle of your Flip Three: the cards keep coming, then you count as left', () => {
    const g = newGame(['n1', 'n2', 'n3', 'T', 'n4', 'n5', 'n6']);
    hit(g, 2);
    Game.prototype.act.call(g, 2, { type: 'target', targetId: 3 });
    Game.prototype.removePlayer.call(g, 3);
    expect(g.decision).toMatchObject({ type: 'flip_three_draw', playerId: 3 });
    expect(g.hand(3).status).toBe(STATUS.ACTIVE);
    g.timeout(); // the clock draws the three cards
    expect(g.hand(3)).toMatchObject({ numbers: [2, 4, 5, 6], status: STATUS.LEFT });
    expect(p(g, 3).roundScore).toBe(0);
    expect(g.decision).toMatchObject({ type: 'hit_or_stay', playerId: 1 });
  });

  it('leaving in the middle of your Flip Three: a bust stays a bust', () => {
    const g = newGame(['n1', 'n2', 'n3', 'T', 'n2']);
    hit(g, 2);
    Game.prototype.act.call(g, 2, { type: 'target', targetId: 3 });
    Game.prototype.removePlayer.call(g, 3);
    g.timeout();
    expect(g.hand(3).status).toBe(STATUS.BUSTED);
  });
});

describe('random whole games (the rules hold up under any play)', () => {
  // A tiny seeded random generator so a failure can be replayed.
  const mulberry = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  function playRandomGame(seed, playerCount, { leave = false } = {}) {
    const rng = mulberry(seed);
    const ids = Array.from({ length: playerCount }, (_, i) => i + 1);
    const g = new Game({ playerIds: ids, rng });
    let steps = 0;
    while (!g.finished) {
      steps += 1;
      if (steps > 20000) throw new Error(`game ${seed} did not finish`);
      if (g.phase === 'round_over') {
        // card conservation: every one of the 94 cards is in the draw or discard pile now
        expect(g.view().drawCount + g.view().discardCount).toBe(94);
        g.beginNextRound();
        continue;
      }
      if (leave && rng() < 0.01) g.removePlayer(ids[Math.floor(rng() * ids.length)]);
      const d = g.decision;
      if (!d) continue;
      if (d.type === 'flip_three_draw') g.timeout(); // the server clock's job
      else if (d.type === 'hit_or_stay') g.act(d.playerId, { type: rng() < 0.6 ? 'hit' : 'stay' });
      else g.act(d.playerId, { type: d.type === 'choose_target' ? 'target' : 'gift', targetId: d.options[Math.floor(rng() * d.options.length)] });
    }
    return g;
  }

  it('300 games with 2-7 players always finish, with consistent results', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const g = playRandomGame(seed, 2 + (seed % 6));
      const { result } = g;
      expect(result.winnerIds.length).toBeGreaterThan(0);
      const best = Math.max(...result.standings.map((x) => x.finalPoints));
      expect(result.winnerIds.every((id) => result.standings.find((x) => x.userId === id).finalPoints === best)).toBe(true);
      if (result.reason === 'target_reached') {
        expect(result.winnerIds).toHaveLength(1);
        expect(best).toBeGreaterThanOrEqual(200);
      }
      for (const row of result.standings) expect(row.finalPoints).toBe(row.rankingPoints);
    }
  });

  it('games where players keep leaving still end properly', () => {
    for (let seed = 1; seed <= 150; seed += 1) {
      const g = playRandomGame(seed, 3 + (seed % 5), { leave: true });
      expect(g.finished).toBe(true);
      for (const row of g.result.standings.filter((x) => x.left)) expect(row.finalPoints).toBe(0);
    }
  });
});
