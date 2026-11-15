# 06 - Real-time (Socket.IO)

Phase 5. Code: `backend/src/realtime/socketServer.js` (server), `frontend/src/services/socket.js` and `frontend/src/features/rooms/useCurrentRoom.js` (browser).

## The idea in one paragraph

The server **pushes**, the browser **acts over HTTP**. Whenever a room changes (someone joins, leaves, the host is asked to start, the game starts, the room closes) the server sends every affected player their own view of the room as a `room:state` message. To *do* something (create, join, leave, start, answer the start question) the browser still calls the normal HTTP endpoints from doc 05, which already have CSRF protection, validation and rate limits. The socket therefore accepts **no messages from the browser at all**; there is nothing in it to attack. Game moves (Phase 6) also use HTTP (`POST /api/rooms/current/game/action`), for the same reason: CSRF check, validation, per-player rate limit, and a plain request/response that is easy to test. The socket only carries the resulting state to everybody.

## The one message

| Event (server to browser) | Payload | Meaning |
|---|---|---|
| `room:state` | `{ room }` | Your current room, exactly the object from `GET /api/rooms/current`, or `{ room: null }` if you are in none (left, kicked, or the room closed) |

It is sent once when the connection opens (so a refreshed page is correct immediately) and after every change. The state includes `game` (the whole table, same for everyone; doc 11) while a match exists. It is personal: only the host receives `startPrompt` and `nextPromptAt`. Players outside a room never hear about it.

**Ordering:** each room has a `version` that goes up with every change. Messages can arrive out of order, so the browser ignores a state older than the one it shows.

## Who may connect

- The connection reads the **same login session cookie** as the API (the same `express-session` middleware runs on the connection request). No session, no connection (`AUTH_REQUIRED`). The user id always comes from the session, never from anything the browser sends.
- **Cross-site WebSocket hijacking:** browsers do not apply CORS to WebSockets, so the server checks the `Origin` header and refuses any browser origin other than `CLIENT_ORIGIN`.
- At most **5 connections per account** (several tabs and devices are fine).
- Incoming messages are limited to 1 KB and ignored anyway.
- **Logout** closes that account's sockets at once, so a signed-out browser stops receiving updates. (A session that merely *expires* is only noticed at the next connection; the grace period below then ends the seat.)

## Disconnects (interim rules)

You keep your seat for a **grace period** after your last connection drops (`ROOM_DISCONNECT_GRACE_SECONDS`, default 30). A page refresh or a bad connection therefore does not throw anyone out; opening another tab also counts as "present". If you are not back in time, you **leave the room through the normal leave rules**:

| Who | Room is waiting | Match in progress |
|---|---|---|
| Ordinary player | Seat is freed | Seat is freed |
| Host | The room is terminated (agreed: "if the creator logs off, the game does not happen") | Ownership passes to the longest-present player |

A player who creates a room over HTTP and never opens the page also gets the grace period, so no ghost rooms stay open.

> The 30 seconds and the "leaving counts as leaving" behaviour are **my interim choice**. The rules document lists "may a player rejoin after disconnecting, and what happens if they do not return" as still open for the project owner. Phase 6 will need a real answer (for example, what happens to a disconnected player's turn). The value is one environment variable.

## In the browser

`useCurrentRoom({ live: true })` loads the room once over HTTP, opens the socket, and applies every `room:state`. The page shows a banner ("Connection lost. Reconnecting...") while the connection is down, and while it is down the hook asks `GET /api/rooms/current` every 5 seconds so the screen does not go stale. In development the Vite dev server forwards `/socket.io` (with WebSocket support) to the backend, so the browser still talks to a single origin.

## Scaling note (Redis-ready)

Everything here is in one process: the RoomManager, the per-user connection map and the grace timers. To run several backend instances, the manager state would move to Redis and Socket.IO would use its Redis adapter; `push()` and `subscribe()` are the only seams that would change. Not needed for the initial single-instance version.

## Tests

`backend/src/tests/realtime.integration.test.js` (needs MySQL; 20 tests): refusing visitors, forged cookies and foreign origins; logout; the connection cap; live create/join/leave/start/close; per-player views and no leaks to outsiders; reconnect inside the grace period; removal after it; host disconnect in a waiting room and during a match; a ghost room. Frontend: `tests/rooms.test.jsx` (pushed states, stale updates, closing, reconnect banner, cleanup) with the connection replaced by a controllable fake.
