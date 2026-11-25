import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import PlayingCard from '../../components/PlayingCard.jsx';

// When an action card is played on someone (Freeze, Flip Three) or a spare Second Chance is
// passed on, a copy of the card flies across the table from the holder to the player chosen.
// Purely decorative: it reads the events the server already sends and never changes the game.
const KIND_OF = { Freeze: 'freeze', 'Flip Three': 'flip_three', 'Second Chance': 'second_chance' };
const FLIGHT_SECONDS = 0.95;

function flightFor(event) {
  if (event.type === 'action_resolved') return { kind: KIND_OF[event.card?.label] ?? 'freeze', label: event.card?.label };
  if (event.type === 'second_chance_given') return { kind: 'second_chance', label: 'Second Chance' };
  return null;
}

export default function FlyingCards({ events, boardRef }) {
  const lastSeen = useRef(null);
  const [flights, setFlights] = useState([]);

  useLayoutEffect(() => {
    const newest = events.reduce((max, e) => Math.max(max, e.id), 0);
    // First render (page load / reconnect): never replay what already happened.
    if (lastSeen.current === null) {
      lastSeen.current = newest;
      return;
    }
    const board = boardRef.current;
    const fresh = events.filter((e) => e.id > lastSeen.current);
    lastSeen.current = Math.max(lastSeen.current, newest);
    if (!board || fresh.length === 0) return;

    const origin = board.getBoundingClientRect();
    const centre = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - origin.left + r.width / 2, y: r.top - origin.top + r.height / 2 };
    };
    const added = [];
    for (const event of fresh) {
      const flight = flightFor(event);
      if (!flight) continue;
      const fromEl = board.querySelector(`[data-seat="${event.playerId}"] .seat__avatar`);
      const toEl = board.querySelector(`[data-seat="${event.targetId}"] .seat__cards`);
      if (!fromEl || !toEl) continue;
      added.push({ ...flight, key: event.id, from: centre(fromEl), to: centre(toEl) });
    }
    if (added.length) setFlights((current) => [...current, ...added]);
  }, [events, boardRef]);

  const done = (key) => setFlights((current) => current.filter((f) => f.key !== key));

  return (
    <div className="flights" aria-hidden="true">
      {flights.map((f) => {
        // a gentle arc: up and over, landing on the target's cards
        const midX = (f.from.x + f.to.x) / 2 + 40;
        const midY = Math.min(f.from.y, f.to.y) - 70;
        return (
          <motion.div
            key={f.key}
            className="flight"
            initial={{ x: f.from.x, y: f.from.y, scale: 0.5, rotate: -20, opacity: 0 }}
            animate={{
              x: [f.from.x, midX, f.to.x],
              y: [f.from.y, midY, f.to.y],
              scale: [0.5, 1.25, 0.85],
              rotate: [-20, 10, 0],
              opacity: [0, 1, 1],
            }}
            transition={{ duration: FLIGHT_SECONDS, ease: [0.3, 0.7, 0.3, 1], times: [0, 0.5, 1] }}
            onAnimationComplete={() => done(f.key)}
          >
            <PlayingCard kind={f.kind} caption={f.label} ariaLabel="" size="sm" className="flight__card" />
          </motion.div>
        );
      })}
    </div>
  );
}
