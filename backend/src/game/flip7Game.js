// The Flip 7 rules engine (Normal Mode). PURE game logic: no database, no sockets, no timers.
// The server owns one Game per room; the browser never decides anything.
//
// How it works: a round is written as one generator function that reads like the Rule book
// ("deal a card to everyone, then ask each player Hit or Stay..."). Whenever the rules need
// a player to decide something, the generator *yields* the question (a "decision") and
// pauses. `act()` answers it and the round carries on from exactly that line. This is what
// lets "Flip Three" pause in the middle of a nested sequence and resume correctly.
//
// Rules source: project owner's "Flip 7 Complete Rules and Online Project Notes"
// (Op Games Ruleset 3.1). Choices that document leaves open are marked  [OPEN]  and are
// listed in docs/11-game-engine.md.
import { buildDeck, shuffle, secureRandom, cardLabel } from './deck.js';
import { AppError } from '../utils/AppError.js';

export const TARGET_SCORE = 200;
export const FLIP7_UNIQUE_NUMBERS = 7;
export const FLIP7_BONUS = 15;
const MAX_EVENTS = 60; // how many recent events the state keeps (for the activity feed)

export const STATUS = Object.freeze({
  ACTIVE: 'active',
  STAYED: 'stayed',
  FROZEN: 'frozen',
  BUSTED: 'busted',
  LEFT: 'left',
});

const reject = (code, message) => new AppError(409, code, message);

export class Game {
  // playerIds: seat order (the order players joined the room).
  // rng / deck / targetScore can be replaced in tests. `deck` = the exact cards in the order
  // they will be drawn (first element is drawn first); when given, it is NOT shuffled.
  constructor({ playerIds, rng = secureRandom, deck = null, targetScore = TARGET_SCORE, dealerIndex = null }) {
    if (new Set(playerIds).size !== playerIds.length || playerIds.length < 2) {
      throw new Error('A game needs at least two different players.');
    }
    this.rng = rng;
    this.targetScore = targetScore;
    this.players = playerIds.map((id) => ({ id, total: 0, hits: 0, busts: 0, left: false }));
    this.seq = 0; // goes up with every change (lets browsers ignore out-of-date states)
    this.decisionCounter = 0; // every question gets a new id, so a double-click cannot answer twice
    this.eventId = 0;
    this.events = [];
    this.phase = 'playing'; // 'playing' | 'round_over' | 'finished'
    this.decision = null; // what the game is waiting for, or null
    this.result = null;
    this.roundNumber = 0;
    this.round = null;
    this.lastRound = null; // summary of the round that just ended

    // [OPEN] The rules only say "choose a player to be the dealer": the first dealer is random.
    this.dealerIndex = dealerIndex ?? Math.floor(rng() * this.players.length);

    if (deck) {
      this.drawPile = [...deck].reverse(); // pop() takes from the end
      this.fixedDeck = true;
    } else {
      this.drawPile = shuffle(buildDeck(), rng);
    }
    this.discardPile = [];
    this.#startRound(this.dealerIndex);
  }

  // ---- reading the state ------------------------------------------------------------------

  get finished() {
    return this.phase === 'finished';
  }
  get playersInMatch() {
    return this.players.filter((p) => !p.left);
  }
  #player(id) {
    return this.players.find((p) => p.id === id);
  }
  hand(id) {
    return this.round?.hands.get(id);
  }
  #activeIds() {
    return this.players.filter((p) => this.round.hands.get(p.id).status === STATUS.ACTIVE).map((p) => p.id);
  }

  // Round score for one hand, in the rulebook's order:
  // (sum of Number cards x2 if x2) + addition modifiers + 15 for Flip 7. A bust scores 0.
  static scoreHand(hand) {
    if (hand.status === STATUS.BUSTED || hand.status === STATUS.LEFT) return 0;
    const numberSum = hand.numbers.reduce((a, b) => a + b, 0);
    const doubled = hand.mods.some((c) => c.modifier === 'x2');
    const additions = hand.mods.filter((c) => c.modifier !== 'x2').reduce((a, c) => a + Number(c.modifier.slice(1)), 0);
    return numberSum * (doubled ? 2 : 1) + additions + (hand.flip7 ? FLIP7_BONUS : 0);
  }

  // ---- the three ways the outside world changes the game --------------------------------------

  // A player answers the pending decision. Throws AppError if it is not their decision or the
  // answer is not allowed. Returns the events this answer caused.
  act(playerId, action) {
    const d = this.decision;
    if (this.finished || !d) throw reject('NOTHING_TO_DO', 'The game is not waiting for a move.');
    if (d.type === 'flip_three_draw') throw reject('NOTHING_TO_DO', 'The Flip Three cards are being drawn.');
    if (d.playerId !== playerId) throw reject('NOT_YOUR_TURN', 'It is not your turn.');
    // The browser says which question it is answering; an answer to an older one is refused.
    if (action?.decisionId !== undefined && action.decisionId !== d.id) throw reject('STALE_MOVE', 'That move is out of date.');
    const answer = this.#validate(d, action);
    return this.#resume(answer);
  }

  // The time limit ran out: take the default answer for whoever was asked.
  // Hit/Stay -> Stay. Freeze / Flip Three -> played on a RANDOM player, the holder included
  // (the project owner's choice, to keep things fun). A spare Second Chance -> discarded.
  timeout() {
    const d = this.decision;
    if (this.finished || !d) return [];
    return this.#resume(this.#defaultAnswer(d, { random: true }));
  }

  // Someone left the match. They get nothing (0 points) and play no more.
  // `keepPoints`: the host removed them (not their choice), so their banked points still count.
  removePlayer(playerId, { keepPoints = false } = {}) {
    const player = this.#player(playerId);
    if (!player || player.left || this.finished) return [];
    const mark = this.eventId;
    player.left = true;
    player.keepPoints = keepPoints;
    this.#emit('player_left', { playerId });
    if (this.playersInMatch.length < 2) {
      // Only one player is left: the match is over and they win. [OPEN] the unfinished round
      // is not scored; the survivor keeps the points from completed rounds.
      this.#finish('last_player');
      return this.#eventsSince(mark);
    }
    if (this.round && this.phase === 'playing') {
      const hand = this.round.hands.get(playerId);
      hand.status = STATUS.LEFT; // whatever they had this round is lost with them
      if (hand.secondChance) {
        this.discardPile.push(hand.secondChance);
        hand.cards = hand.cards.filter((c) => c !== hand.secondChance); // so it is not discarded twice
        hand.secondChance = null;
      }
    }
    if (this.decision?.playerId === playerId) this.#resume(this.#defaultAnswer(this.decision));
    else {
      this.seq += 1;
      if (this.phase === 'round_over') this.#checkWin(); // the leaver may have been the one tied at the top
    }
    return this.#eventsSince(mark);
  }

  // After the pause that shows the round summary.
  beginNextRound() {
    if (this.phase !== 'round_over') throw reject('ROUND_NOT_OVER', 'The round is not over yet.');
    const mark = this.eventId;
    // The dealer role passes to the next player who is still in the match.
    let next = this.dealerIndex;
    do {
      next = (next + 1) % this.players.length;
    } while (this.players[next].left);
    this.dealerIndex = next;
    this.#startRound(next);
    return this.#eventsSince(mark);
  }

  // ---- what the browsers see ------------------------------------------------------------------
  // Everything in Flip 7 is face-up, so ONE view serves every player. The only secret is the
  // order of the draw pile, which is never included (only how many cards are in it).
  view() {
    const r = this.round;
    return {
      seq: this.seq,
      phase: this.phase,
      targetScore: this.targetScore,
      roundNumber: this.roundNumber,
      dealerId: this.players[this.dealerIndex].id,
      players: this.players.map((p) => {
        const hand = r?.hands.get(p.id);
        return {
          id: p.id,
          total: p.total,
          left: p.left,
          status: p.left ? STATUS.LEFT : hand?.status ?? STATUS.ACTIVE,
          numbers: hand ? [...hand.numbers] : [],
          modifiers: hand ? hand.mods.map((c) => c.modifier) : [],
          hasSecondChance: Boolean(hand?.secondChance),
          bustCard: hand?.bustCard ?? null, // the duplicate Number that busted this hand, or null
          savedIndexes: hand ? [...hand.savedIndexes] : [], // which `numbers` a Second Chance saved
          flip7: Boolean(hand?.flip7),
          roundScore: hand ? Game.scoreHand(hand) : 0,
        };
      }),
      drawCount: this.drawPile.length,
      discardCount: this.discardPile.length,
      decision: this.decision
        ? { id: this.decision.id, type: this.decision.type, playerId: this.decision.playerId, card: this.decision.card ?? null, options: this.decision.options ?? null }
        : null,
      lastRound: this.lastRound,
      result: this.result,
      events: this.events,
    };
  }

  // ---- internals ------------------------------------------------------------------------------

  #emit(type, data = {}) {
    const event = { id: (this.eventId += 1), type, round: this.roundNumber, ...data };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    return event;
  }
  // `mark` is the event id counter before the change; this returns what happened since.
  #eventsSince(mark) {
    return this.events.filter((e) => e.id > mark);
  }

  #validate(d, action) {
    const bad = (message) => reject('INVALID_MOVE', message);
    if (!action || typeof action !== 'object') throw bad('That move is not valid.');
    if (d.type === 'hit_or_stay') {
      if (action.type !== 'hit' && action.type !== 'stay') throw bad('Choose Hit or Stay.');
      return action;
    }
    const wanted = d.type === 'choose_target' ? 'target' : 'gift';
    if (action.type !== wanted) throw bad(d.type === 'choose_target' ? 'Choose who the card is played on.' : 'Choose who gets the Second Chance.');
    if (!d.options.includes(action.targetId)) throw bad('That player cannot be chosen.');
    return action;
  }

  // `random`: a time-out picks the target by chance. Without it (a player who LEFT while a
  // card choice was pending) the card is simply discarded.
  #defaultAnswer(d, { random = false } = {}) {
    if (d.type === 'flip_three_draw') return undefined; // just carry on drawing
    if (d.type === 'hit_or_stay') return { type: 'stay' };
    if (d.type === 'choose_target') {
      const candidates = random ? d.options.filter((id) => !this.#player(id).left) : [];
      if (candidates.length === 0) return { type: 'target', targetId: null };
      return { type: 'target', targetId: candidates[Math.floor(this.rng() * candidates.length)] };
    }
    return { type: 'gift', targetId: null }; // discard the spare Second Chance
  }

  #startRound(dealerIndex) {
    this.roundNumber += 1;
    this.phase = 'playing';
    this.lastRound = null;
    const hands = new Map();
    for (const p of this.players) {
      hands.set(p.id, {
        numbers: [], // values of the Number cards in the line (a duplicate saved by Second Chance included)
        savedIndexes: [], // positions in `numbers` of duplicates that a Second Chance saved
        mods: [], // Score Modifier cards
        secondChance: null,
        cards: [], // every card in front of the player (discarded when the round ends)
        status: p.left ? STATUS.LEFT : STATUS.ACTIVE,
        flip7: false,
      });
    }
    this.round = { hands, ended: false, endReason: null };
    this.#emit('round_started', { dealerId: this.players[dealerIndex].id });
    this.flow = this.#roundFlow(dealerIndex);
    this.#resume(undefined, true);
  }

  // Advance the round until it needs a decision, or ends.
  #resume(answer, first = false) {
    const mark = this.eventId;
    this.seq += 1;
    const step = first ? this.flow.next() : this.flow.next(answer);
    if (step.done) {
      this.decision = null;
      this.#endRound();
    } else {
      this.decision = { ...step.value, id: (this.decisionCounter += 1) };
    }
    return this.#eventsSince(mark);
  }

  // Next card from the draw pile; when it is empty the discard pile is shuffled into a new one
  // (cards in front of players are left where they are). Returns null only if there is truly
  // nothing left, which cannot normally happen with 94 cards.
  #draw() {
    if (this.drawPile.length === 0 && this.discardPile.length > 0) {
      this.drawPile = shuffle(this.discardPile, this.rng);
      this.discardPile = [];
      this.#emit('deck_reshuffled');
    }
    const card = this.drawPile.pop();
    if (!card) {
      this.round.ended = true; // [OPEN] nothing left to draw: the round ends, active players keep their cards
      this.round.endReason = 'deck_empty';
      return null;
    }
    return card;
  }

  *#roundFlow(dealerIndex) {
    const { round } = this;
    const n = this.players.length;

    // 1) The initial deal: one card to each player, dealer last. If an Action card turns up
    //    the dealing pauses while it is resolved (that is simply the `yield*` below).
    for (let k = 1; k <= n && !round.ended; k += 1) {
      const id = this.players[(dealerIndex + k) % n].id;
      if (round.hands.get(id).status !== STATUS.ACTIVE) continue; // frozen before getting a card
      const card = this.#draw();
      if (!card) break;
      this.#emit('card_dealt', { playerId: id, card: this.#cardInfo(card), via: 'deal' });
      yield* this.#receive(id, card, null);
    }

    // 2) Turns: next active player after the dealer, one Hit or Stay at a time.
    let seat = dealerIndex;
    while (!round.ended) {
      const ids = this.#activeIds();
      if (ids.length === 0) {
        round.endReason = 'no_active_players';
        break;
      }
      let id = null;
      for (let k = 1; k <= n; k += 1) {
        const candidate = this.players[(seat + k) % n].id;
        if (ids.includes(candidate)) {
          id = candidate;
          seat = (seat + k) % n;
          break;
        }
      }
      const choice = yield { type: 'hit_or_stay', playerId: id };
      const hand = round.hands.get(id);
      if (hand.status !== STATUS.ACTIVE) continue; // they left while it was their turn
      if (choice.type === 'stay') {
        hand.status = STATUS.STAYED;
        this.#emit('player_stayed', { playerId: id, roundScore: Game.scoreHand(hand) });
      } else {
        this.#player(id).hits += 1;
        this.#emit('player_hit', { playerId: id });
        const card = this.#draw();
        if (!card) break;
        this.#emit('card_dealt', { playerId: id, card: this.#cardInfo(card), via: 'hit' });
        yield* this.#receive(id, card, null);
      }
    }
  }

  // A player receives a card. `deferred` is null normally; during a Flip Three it is the list
  // where newly drawn Freeze / Flip Three cards are set aside until the three cards are drawn.
  *#receive(id, card, deferred) {
    const { round } = this;
    const hand = round.hands.get(id);

    if (card.kind === 'number') {
      if (hand.numbers.includes(card.value)) {
        if (hand.secondChance) {
          // Second Chance (PROJECT OWNER'S RULE, differs from the printed rulebook, which discards
          // both cards): only the Second Chance is discarded. The duplicate STAYS in the line and
          // its points count; it is marked as "saved" so the table can show why there was no bust.
          // A further copy of the same number still busts (or uses another Second Chance), and
          // Flip 7 still needs seven DIFFERENT numbers.
          this.discardPile.push(hand.secondChance);
          hand.cards = hand.cards.filter((c) => c !== hand.secondChance);
          hand.secondChance = null;
          hand.numbers.push(card.value);
          hand.cards.push(card);
          hand.savedIndexes.push(hand.numbers.length - 1);
          this.#emit('second_chance_used', { playerId: id, card: this.#cardInfo(card) });
        } else {
          hand.cards.push(card); // stays in front of them until the round ends
          hand.bustCard = card.value; // shown on the table so everyone sees what caused the bust
          hand.status = STATUS.BUSTED;
          this.#player(id).busts += 1;
          this.#emit('player_busted', { playerId: id, card: this.#cardInfo(card) });
        }
        return;
      }
      hand.numbers.push(card.value);
      hand.cards.push(card);
      if (new Set(hand.numbers).size === FLIP7_UNIQUE_NUMBERS) {
        hand.flip7 = true;
        round.ended = true;
        round.endReason = 'flip7';
        round.flip7PlayerId = id;
        this.#emit('flip7_achieved', { playerId: id });
      }
      return;
    }

    if (card.kind === 'modifier') {
      hand.mods.push(card);
      hand.cards.push(card);
      return;
    }

    // Action cards
    if (card.action === 'second_chance') {
      if (!hand.secondChance) {
        hand.secondChance = card;
        hand.cards.push(card);
        return;
      }
      // Already holding one: it must go to another active player without one, or be discarded.
      const options = this.#activeIds().filter((other) => other !== id && !round.hands.get(other).secondChance);
      if (options.length === 0) {
        this.discardPile.push(card);
        this.#emit('second_chance_discarded', { playerId: id });
        return;
      }
      const answer = yield { type: 'choose_gift', playerId: id, card: 'second_chance', options };
      if (answer.targetId == null || !options.includes(answer.targetId) || round.hands.get(answer.targetId).status !== STATUS.ACTIVE) {
        this.discardPile.push(card);
        this.#emit('second_chance_discarded', { playerId: id });
      } else {
        const receiver = round.hands.get(answer.targetId);
        receiver.secondChance = card;
        receiver.cards.push(card);
        this.#emit('second_chance_given', { playerId: id, targetId: answer.targetId });
      }
      return;
    }

    // Freeze / Flip Three
    if (deferred) {
      deferred.push({ card, holder: id });
      this.#emit('action_set_aside', { playerId: id, card: this.#cardInfo(card) });
      return;
    }
    yield* this.#playAction(id, card);
  }

  // The holder of a Freeze / Flip Three chooses an active player (possibly themselves) to play it on.
  *#playAction(holder, card) {
    const { round } = this;
    const options = this.#activeIds();
    if (options.length === 0) {
      this.discardPile.push(card);
      return;
    }
    let targetId;
    if (options.length === 1) {
      targetId = options[0]; // the only active player must receive it
    } else {
      const answer = yield { type: 'choose_target', playerId: holder, card: card.action, options };
      targetId = answer.targetId;
    }
    const target = targetId == null ? null : round.hands.get(targetId);
    if (!target || target.status !== STATUS.ACTIVE) {
      this.discardPile.push(card);
      return;
    }
    target.cards.push(card);
    this.#emit('action_resolved', { playerId: holder, targetId, card: this.#cardInfo(card) });

    if (card.action === 'freeze') {
      target.status = STATUS.FROZEN; // banks the points collected; not a bust
      return;
    }
    yield* this.#flipThree(targetId);
  }

  // The target takes the next three cards, one at a time. Number, modifier and Action cards all
  // count as one of the three. A bust stops it; Flip 7 ends the round; a Freeze or Flip Three
  // drawn during it waits until all three are drawn.
  *#flipThree(targetId) {
    const { round } = this;
    const hand = round.hands.get(targetId);
    const setAside = [];
    let drawn = 0;

    for (let i = 0; i < 3; i += 1) {
      if (round.ended || hand.status !== STATUS.ACTIVE) break;
      // A pause nobody answers: the clock resumes it (timeout()), so the cards arrive one by one.
      // Cards not drawn after a bust simply stay on top of the draw pile, in their order.
      yield { type: 'flip_three_draw', playerId: targetId, card: 'flip_three', options: [i + 1] };
      if (round.ended || hand.status !== STATUS.ACTIVE) break; // they may have left during the pause
      const card = this.#draw();
      if (!card) return;
      drawn += 1;
      this.#emit('card_dealt', { playerId: targetId, card: this.#cardInfo(card), via: 'flip_three' });
      yield* this.#receive(targetId, card, setAside);
    }
    // Tell the table why the drawing stopped early (the undrawn cards stay on the deck).
    if (hand.status === STATUS.BUSTED && drawn < 3) this.#emit('flip_three_stopped', { playerId: targetId, remaining: 3 - drawn });

    for (const { card, holder } of setAside) {
      const holderHand = round.hands.get(holder);
      if (round.ended || holderHand.status === STATUS.BUSTED || holderHand.status === STATUS.LEFT) {
        this.discardPile.push(card);
        continue;
      }
      yield* this.#playAction(holder, card);
    }
  }

  #cardInfo(card) {
    return { id: card.id, kind: card.kind, label: cardLabel(card) };
  }

  // The round is over: score everyone, put the cards on the discard pile, then either finish
  // the match or wait for the next round.
  #endRound() {
    const { round } = this;
    const scores = [];
    for (const p of this.players) {
      const hand = round.hands.get(p.id);
      const roundScore = Game.scoreHand(hand);
      if (!p.left) p.total += roundScore;
      scores.push({ id: p.id, status: hand.status, roundScore, total: p.total, flip7: hand.flip7 });
      this.discardPile.push(...hand.cards);
      hand.cards = [];
    }
    this.lastRound = { number: this.roundNumber, endReason: round.endReason ?? 'no_active_players', scores };
    this.#emit('round_scored', { scores, endReason: this.lastRound.endReason });

    this.phase = 'round_over';
    this.#checkWin();
  }

  // The 200-point check happens only after a round is scored (never halfway through).
  // The player with the most points wins; if the top score is tied the game goes on with
  // extra rounds until there is a single winner.
  #checkWin() {
    const alive = this.playersInMatch;
    const best = Math.max(...alive.map((p) => p.total));
    const leaders = alive.filter((p) => p.total === best);
    if (best >= this.targetScore && leaders.length === 1) this.#finish('target_reached');
  }

  #finish(reason) {
    this.phase = 'finished';
    this.decision = null;
    this.flow = null;
    const alive = this.playersInMatch;
    const best = Math.max(...alive.map((p) => p.total));
    const winnerIds = alive.filter((p) => p.total === best).map((p) => p.id);
    // Ranking points are the points earned in the game; someone who left mid-match gets nothing
    // (someone the host removed keeps what they had banked).
    const standings = this.players
      .map((p) => {
        const points = p.left && !p.keepPoints ? 0 : p.total;
        return { userId: p.id, finalPoints: points, rankingPoints: points, hits: p.hits, busts: p.busts, left: p.left };
      })
      .sort((a, b) => b.finalPoints - a.finalPoints);
    this.result = { reason, rounds: this.roundNumber, winnerIds, standings };
    this.#emit('match_completed', { winnerIds, reason });
    this.seq += 1;
  }
}
