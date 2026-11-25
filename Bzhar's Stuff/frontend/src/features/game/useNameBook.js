import { useRef } from 'react';

// The game only knows player ids. Names come from the room's player list, but someone who
// LEAVES disappears from that list, while the scoreboard must still show who they were. This
// remembers every player seen so far. Returns { nameOf, avatarOf }.
export function useNameBook(players) {
  const book = useRef(new Map());
  for (const p of players) book.current.set(p.id, { nickname: p.nickname, avatar: p.avatar });
  return {
    nameOf: (id) => book.current.get(id)?.nickname ?? 'A player',
    avatarOf: (id) => book.current.get(id)?.avatar ?? '',
  };
}
