import { useEffect, useRef } from 'react';
import Avatar from '../../components/Avatar.jsx';
import Button from '../../components/Button.jsx';
import PlayingCard from '../../components/PlayingCard.jsx';
import { formatClock, useCountdown } from '../rooms/useCountdown.js';
import { actionName } from './describeEvent.js';
import FlyingCards from './FlyingCards.jsx';
import { useRecentEvents } from './useRecentEvents.js';

// How long the "Second Chance saved you" sequence lasts (matches the CSS timeline).
const SAVE_MS = 2600;
const SAVE_EVENTS = ['second_chance_used'];
import { useNameBook } from './useNameBook.js';
import './GameBoard.css';

const STATUS_TEXT = { active: '', stayed: 'Stayed', frozen: 'Frozen', busted: 'Bust!', left: 'Left' };

// Draws the table. It only SHOWS what the server sent and sends the player's choices back;
// it never decides what is legal (the server checks every move).
//   room         the room state (includes room.game)
//   me           the signed-in user's id
//   clockOffset  server time - browser time
//   onAction     async (action) => void   sends a move
//   busy         true while a move is being sent
export default function GameBoard({ room, me, clockOffset, onAction, onReady, onStartWithReady, busy }) {
  const { game } = room;
  const { nameOf, avatarOf } = useNameBook(room.players);
  const secondsLeft = useCountdown(game.timer?.endsAt ?? null, clockOffset);
  const decision = game.decision;
  const myTurn = decision?.playerId === me;
  // What the highlighted seat is doing right now, in words that fit the moment.
  const turnLabel = decision?.type === 'flip_three_draw' ? 'Drawing…' : myTurn ? 'Your turn' : 'Thinking…';

  const boardRef = useRef(null);
  // While I must choose who gets a card, the players I may choose can be picked on the table too.
  const picking = game.phase === 'playing' && myTurn && (decision.type === 'choose_target' || decision.type === 'choose_gift');
  const pickLabel = decision?.type === 'choose_gift' ? 'Second Chance' : actionName(decision?.card);
  const pick = (targetId) => onAction({ decisionId: decision.id, type: decision.type === 'choose_gift' ? 'gift' : 'target', targetId });

  // The leader(s): most points among players still in the match. Nobody leads at 0.
  const inMatch = game.players.filter((p) => !p.left);
  const best = Math.max(0, ...inMatch.map((p) => p.total));
  const leaderIds = new Set(best > 0 ? inMatch.filter((p) => p.total === best).map((p) => p.id) : []);
  // A Second Chance that has just saved someone: their row plays the "duplicate, saved" sequence.
  const recentSaves = useRecentEvents(game.events, SAVE_EVENTS, SAVE_MS);

  return (
    <section className="game" aria-label="Game table" ref={boardRef}>
      <FlyingCards events={game.events} boardRef={boardRef} />
      <header className="game__bar">
        <div className="deck" aria-label={`${game.drawCount} cards left in the deck`}>
          <span className="deck__pile" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <PlayingCard key={i} faceUp={false} size="sm" className="deck__card" ariaLabel="" />
            ))}
          </span>
          <span className="deck__count">
            <span className="sr-only">Deck: </span>
            <span className="deck__number">{game.drawCount}</span>
            <span className="deck__unit">cards</span>
          </span>
        </div>
        <dl className="game__facts">
          <div className="fact fact--round">
            <dt aria-hidden="true">Round</dt>
            <dd>
              <span className="sr-only">Round </span>
              <strong>{game.roundNumber}</strong>
            </dd>
          </div>
          <div className="fact">
            <dt aria-hidden="true">Dealer</dt>
            <dd>
              <span className="sr-only">Dealer: </span>
              {nameOf(game.dealerId)}
            </dd>
          </div>
          <div className="fact">
            <dt aria-hidden="true">Goal</dt>
            <dd>First to {game.targetScore}</dd>
          </div>
        </dl>
      </header>

      {game.phase === 'finished' && <FinalResults room={room} nameOf={nameOf} avatarOf={avatarOf} me={me} onReady={onReady} onStartWithReady={onStartWithReady} busy={busy} />}
      {game.phase === 'round_over' && <RoundSummary game={game} nameOf={nameOf} seconds={secondsLeft} />}
      {game.phase === 'playing' && (
        <ActionPanel
          game={game}
          me={me}
          myTurn={myTurn}
          nameOf={nameOf}
          seconds={secondsLeft}
          onAction={onAction}
          busy={busy}
        />
      )}

      <ul className="seats" aria-label="Players">
        {game.players.map((p) => (
          <Seat
            key={p.id}
            player={p}
            name={nameOf(p.id)}
            avatar={avatarOf(p.id)}
            isMe={p.id === me}
            isDealer={p.id === game.dealerId}
            isLeader={leaderIds.has(p.id)}
            justSaved={recentSaves.some((e) => e.playerId === p.id)}
            isTurn={game.phase === 'playing' && decision?.playerId === p.id}
            turnLabel={turnLabel}
            target={game.targetScore}
            pickAs={picking && decision.options.includes(p.id) ? pickLabel : null}
            onPick={() => pick(p.id)}
            busy={busy}
          />
        ))}
      </ul>
    </section>
  );
}

function Crown() {
  return (
    <svg className="seat__crown" viewBox="0 0 32 22" aria-hidden="true" focusable="false">
      <path d="M3 18 L1.5 6 L9.5 11.5 L16 2 L22.5 11.5 L30.5 6 L29 18 Z" fill="url(#crown-gold)" stroke="#7A5A1E" strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="3" y="17.5" width="26" height="3.5" rx="1.2" fill="#B9862F" stroke="#7A5A1E" strokeWidth="1" />
      <circle cx="16" cy="2.6" r="1.8" fill="#F6EFDD" stroke="#7A5A1E" strokeWidth="0.8" />
      <circle cx="1.8" cy="6" r="1.5" fill="#F6EFDD" stroke="#7A5A1E" strokeWidth="0.8" />
      <circle cx="30.2" cy="6" r="1.5" fill="#F6EFDD" stroke="#7A5A1E" strokeWidth="0.8" />
      <circle cx="16" cy="13" r="1.7" fill="#B65A45" />
      <defs>
        <linearGradient id="crown-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F6D98F" />
          <stop offset="1" stopColor="#C4933F" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Seat({ player, name, avatar, isMe, isDealer, isLeader, isTurn, turnLabel, target, pickAs, onPick, busy, justSaved }) {
  const saved = player.savedIndexes ?? [];
  // While the save sequence plays: the newest saved card, and the earlier card it duplicated.
  const newestSaved = justSaved && saved.length ? saved[saved.length - 1] : -1;
  const dupValue = newestSaved >= 0 ? player.numbers[newestSaved] : null;
  const matchIndex = dupValue === null ? -1 : player.numbers.indexOf(dupValue);
  const cardClass = (i) =>
    ['seat__card', saved.includes(i) && 'seat__card--saved', i === newestSaved && 'seat__card--dup-new', i === matchIndex && 'seat__card--dup-match']
      .filter(Boolean)
      .join(' ');
  const out = player.status !== 'active';
  // Progress toward the goal, in % of the bar: points already banked, then this round's (not yet safe) points.
  const banked = Math.min(100, (player.total / target) * 100);
  const pending = Math.min(100 - banked, (player.roundScore / target) * 100);
  const classes = ['seat', isTurn && 'seat--turn', out && `seat--${player.status}`, isMe && 'seat--me', isLeader && 'seat--leader', pickAs && 'seat--pickable']
    .filter(Boolean)
    .join(' ');
  return (
    <li className={classes} aria-current={isTurn ? 'true' : undefined} data-seat={player.id}>
      {pickAs && (
        <button type="button" className="seat__pick" onClick={onPick} disabled={busy} aria-label={`Give ${pickAs} to ${isMe ? 'myself' : name}`}>
          <span className="seat__pick-chip" aria-hidden="true">
            Give {pickAs} {isMe ? 'to yourself' : ''}
          </span>
        </button>
      )}
      {player.status === 'frozen' && <span className="seat__ice" aria-hidden="true" />}
      <div className="seat__who">
        <span className="seat__avatar">
          {isLeader && <Crown />}
          <Avatar id={avatar} name="" size={44} />
          {isDealer && (
            <span className="seat__dealer" aria-hidden="true" title="Dealer">
              D
            </span>
          )}
        </span>
        <span className="seat__id">
          <span className="seat__name">
            {name}
            {isMe && ' (you)'}
          </span>
          <span className="seat__tags">
            {isDealer && <span className="tag tag--dealer">Dealer</span>}
            {isTurn && <span className="tag tag--turn">{turnLabel}</span>}
            {out && <span className={`tag tag--${player.status}`}>{STATUS_TEXT[player.status]}</span>}
            {player.flip7 && <span className="tag tag--flip7">Flip 7!</span>}
            {isLeader && <span className="tag tag--leader">Leader</span>}
          </span>
        </span>
      </div>
      <div className="seat__cards" aria-label={`Cards of ${name}`}>
        {player.numbers.map((n, i) => (
          <PlayingCard
            key={`n${i}-${n}`}
            deal
            label={String(n)}
            size="sm"
            className={cardClass(i)}
            ariaLabel={saved.includes(i) ? `Card ${n}, a duplicate saved by Second Chance` : undefined}
          />
        ))}
        {player.bustCard != null && (
          <PlayingCard
            key="bust"
            deal
            label={String(player.bustCard)}
            ariaLabel={`Card ${player.bustCard}, the duplicate that caused the bust`}
            size="sm"
            state="danger"
            className="seat__card seat__card--bust"
          />
        )}
        {player.modifiers.map((m, i) => (
          <PlayingCard key={`m${i}-${m}`} deal kind="modifier" label={m} size="sm" className="seat__card" />
        ))}
        {player.hasSecondChance && (
          <PlayingCard deal kind="second_chance" caption="2nd Chance" ariaLabel="Second Chance" size="sm" className="seat__card" />
        )}
        {justSaved && !player.hasSecondChance && (
          // the Second Chance that was just used, shown one last time as it breaks away
          <span className="seat__sc-used" aria-hidden="true">
            <PlayingCard kind="second_chance" caption="2nd Chance" ariaLabel="" size="sm" className="seat__card" />
          </span>
        )}
        {player.numbers.length + player.modifiers.length === 0 && !player.hasSecondChance && (
          <span className="seat__empty">No cards</span>
        )}
      </div>
      <div className="seat__score" aria-label={`${player.left ? 0 : player.total} points in total`}>
        <span className="seat__total">{player.left ? 0 : player.total}</span>
        <span className="seat__unit" aria-hidden="true">pts</span>
        <span className="seat__round">{player.left ? '' : `+${player.roundScore} this round`}</span>
        {/* how close they are to the goal: banked total, plus this round's points as a lighter extension */}
        {!player.left && (
          <span className="seat__goal" aria-hidden="true">
            <span className="seat__goal-total" style={{ width: `${banked}%` }} />
            <span className="seat__goal-round" style={{ width: `${pending}%` }} />
          </span>
        )}
      </div>
    </li>
  );
}

function ActionPanel({ game, me, myTurn, nameOf, seconds, onAction, busy }) {
  const d = game.decision;
  const urgent = seconds != null && seconds <= 5;
  const timer = seconds != null && (
    <span className={`timer ${urgent ? 'timer--urgent' : ''}`} role="timer" aria-label={`${seconds} seconds left`}>
      {formatClock(seconds)}
    </span>
  );
  if (!d) return null;

  if (d.type === 'flip_three_draw') {
    const step = d.options[0]; // the card about to be drawn, 1 to 3
    return (
      <div className="panel panel--wait" role="status">
        <p>
          <strong>{d.playerId === me ? 'You are' : `${nameOf(d.playerId)} is`}</strong> drawing Flip Three card {step} of 3…
        </p>
        {/* progress: one slot per card, filled as they are drawn */}
        <ol className="draw-steps" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <li key={n} className={`draw-steps__slot${n < step ? ' is-done' : n === step ? ' is-current' : ''}`} />
          ))}
        </ol>
      </div>
    );
  }

  if (!myTurn) {
    return (
      <div className="panel panel--wait" role="status">
        <p>
          Waiting for <strong>{nameOf(d.playerId)}</strong>
          {d.type === 'choose_target' && ` to play ${actionName(d.card)}`}
          {d.type === 'choose_gift' && ' to pass on a Second Chance'}…
        </p>
        {timer}
      </div>
    );
  }

  const send = (extra) => onAction({ decisionId: d.id, ...extra });

  if (d.type === 'hit_or_stay') {
    return (
      <div className="panel panel--mine" role="group" aria-label="Your turn">
        <div className="panel__text">
          <h2>Your turn</h2>
          <p>Take another card, or stay and keep your points. If you do not choose, you stay.</p>
        </div>
        {timer}
        {/* the move made most often gets the biggest targets */}
        <div className="panel__buttons panel__buttons--big">
          <Button onClick={() => send({ type: 'hit' })} disabled={busy}>
            Hit
          </Button>
          <Button variant="secondary" onClick={() => send({ type: 'stay' })} disabled={busy}>
            Stay
          </Button>
        </div>
      </div>
    );
  }

  const isGift = d.type === 'choose_gift';
  return (
    <div className="panel panel--mine panel--action" role="group" aria-label={isGift ? 'Give a Second Chance' : `Play ${actionName(d.card)}`}>
      <PlayingCard
        kind={isGift ? 'second_chance' : d.card}
        caption={isGift ? 'Second Chance' : actionName(d.card)}
        ariaLabel={isGift ? 'Second Chance card' : `${actionName(d.card)} card`}
        size="sm"
        deal
        className="panel__card"
      />
      <div className="panel__text">
        <h2>{isGift ? 'Pass on your spare Second Chance' : `You drew ${actionName(d.card)}`}</h2>
        <p>
          {isGift
            ? 'You already have one. Choose who gets this one.'
            : d.card === 'freeze'
              ? 'The player you choose banks their points and is out of the round. If time runs out, a random player gets it.'
              : 'The player you choose must take the next three cards. If time runs out, a random player gets it.'}
        </p>
      </div>
      {timer}
      <div className="panel__buttons">
        {d.options.map((id) => (
          <Button key={id} variant={id === me ? 'secondary' : 'primary'} onClick={() => send({ type: isGift ? 'gift' : 'target', targetId: id })} disabled={busy}>
            {id === me ? 'Myself' : nameOf(id)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function RoundSummary({ game, nameOf, seconds }) {
  const rows = [...game.lastRound.scores].sort((a, b) => b.total - a.total);
  const bestRound = Math.max(0, ...rows.map((r) => r.roundScore)); // the round's best score stands out
  return (
    <div className="panel panel--summary" role="status">
      <h2>Round {game.lastRound.number} is over</h2>
      <table className="scores">
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">This round</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={bestRound > 0 && r.roundScore === bestRound ? 'scores__best' : undefined}>
              <th scope="row">{nameOf(r.id)}{r.flip7 ? ' (Flip 7!)' : ''}</th>
              <td>{r.status === 'busted' ? 'Bust (0)' : r.status === 'left' ? 'Left' : `+${r.roundScore}`}</td>
              <td>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {seconds != null && <p>Next round in {seconds} s…</p>}
    </div>
  );
}

const ordinal = (n) => `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`;

function FinalResults({ room, nameOf, avatarOf, me, onReady, onStartWithReady, busy }) {
  const { game } = room;
  const { result } = game;
  const readyIds = room.readyIds ?? [];
  const iAmReady = readyIds.includes(me);
  const others = room.players.filter((p) => !result.standings.some((s) => s.userId === p.id));
  const headingRef = useRef(null);
  useEffect(() => headingRef.current?.focus(), []);
  const winners = result.winnerIds.map(nameOf);
  const iWon = result.winnerIds.includes(me);
  const topPoints = result.standings[0]?.finalPoints ?? 0;
  const myPlace = result.standings.findIndex((s) => s.userId === me) + 1; // 0 = not in this match
  // The end of a match is the moment people remember: name the winner and their score, and tell
  // everyone else where they finished, instead of a generic line.
  const how = result.reason === 'last_player' ? 'Everyone else left the match.' : `${iWon ? 'You' : winners.join(' and ')} reached ${topPoints} points.`;
  return (
    <div className={`panel panel--final${iWon ? ' panel--won' : ''}`}>
      {iWon && (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <span key={i} style={{ '--i': i }} />
          ))}
        </div>
      )}
      <h2 ref={headingRef} tabIndex={-1}>
        {iWon ? 'You win!' : `${winners.join(' and ')} wins!`}
      </h2>
      <p>
        {how} The match lasted {result.rounds} {result.rounds === 1 ? 'round' : 'rounds'}.
        {!iWon && myPlace > 0 && ` You finished ${ordinal(myPlace)} of ${result.standings.length}.`}
      </p>
      <ol className="standings">
        {result.standings.map((s, i) => (
          <li key={s.userId} className={result.winnerIds.includes(s.userId) ? 'standings__winner' : ''}>
            <span className="standings__rank">{i + 1}</span>
            <Avatar id={avatarOf(s.userId)} name="" size={36} />
            <span className="standings__name">
              {nameOf(s.userId)}
              {s.userId === me && ' (you)'}
              {s.left && <span className="tag tag--left">Left</span>}
            </span>
            <span className="standings__points">
              {s.finalPoints} pts
              <span className="standings__ranking"> +{s.rankingPoints} ranking</span>
            </span>
            {room.players.some((p) => p.id === s.userId) && (
              <span className={`tag ${readyIds.includes(s.userId) ? 'tag--ready' : ''}`}>
                {readyIds.includes(s.userId) ? 'Ready' : 'Not ready'}
              </span>
            )}
          </li>
        ))}
      </ol>
      {others.length > 0 && (
        <>
          <h3 className="standings__subtitle">Not in this match</h3>
          <ul className="standings standings--others" aria-label="Players who were not in this match">
            {others.map((p) => (
              <li key={p.id}>
                <Avatar id={p.avatar} name="" size={36} />
                <span className="standings__name">
                  {p.nickname}
                  {p.id === me && ' (you)'}
                </span>
                <span className={`tag ${readyIds.includes(p.id) ? 'tag--ready' : ''}`}>{readyIds.includes(p.id) ? 'Ready' : 'Not ready'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="rematch">
        {room.canRematch ? (
          <>
            <p role="status">
              {readyIds.length} of {room.playerCount} ready for another match. It starts as soon as everyone here is ready.
            </p>
            <Button onClick={() => onReady(!iAmReady)} loading={busy} variant={iAmReady ? 'secondary' : 'primary'}>
              {iAmReady ? 'Not ready after all' : 'Play again'}
            </Button>
            {room.canStartWithReady && readyIds.length < room.playerCount && (
              <Button variant="secondary" onClick={onStartWithReady} loading={busy}>
                Start now with the players who are ready
              </Button>
            )}
          </>
        ) : (
          <p role="status">Not enough players are left for another match. You can leave the room.</p>
        )}
      </div>
    </div>
  );
}
