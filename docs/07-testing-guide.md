# 07 - Testing guide

## What is tested and how

| Layer | Tool | Command | Needs MySQL? |
| --- | --- | --- | --- |
| Backend rules, validators, managers, game engine | Vitest | `cd backend && npm test` | No |
| Backend HTTP + sockets + database ("integration") | Vitest + supertest + socket.io-client | `cd backend && RUN_DB_TESTS=true npm test` | **Yes** |
| Frontend screens and components | Vitest + Testing Library + jsdom | `cd frontend && npm test` | No |

Without `RUN_DB_TESTS=true` the integration tests are *skipped* (they show as skipped, not as passed), so a quick `npm test` works on any machine. Run the full command before you commit.

## Running the integration tests

1. MySQL 8 running, with the schema loaded from `backend/src/db/schema.sql` (it creates the `flip7_online` database itself).
2. `backend/.env` filled in (the tests use the same database settings as the app).
3. `cd backend && RUN_DB_TESTS=true npm test`

Integration tests create their own users (names start with a unique prefix) and **delete everything they created** when they finish: rooms, users, saved matches. They never touch other rows. If a run is killed half way, leftover test users can be removed with `DELETE FROM Users WHERE google_id LIKE 'h%'` after deleting their rooms and matches (or simply reset your development database).

## What the suites cover (current totals: backend 530+, frontend 127)

| File | Covers |
| --- | --- |
| `flip7Game.test.js` | Every rule with hand-stacked decks (rulebook example 66 / 81), time-outs, leavers, 450 random full games checking invariants |
| `game.integration.test.js` | Moves over HTTP, wrong player, forged ids, double clicks, clocks, live push |
| `match.integration.test.js` | Saving matches and ranking points, leavers on 0, ready system, rematch, host button, spectators, creator rules |
| `matchLifecycle.test.js` | Same rules without a database, plus the saving transaction with a fake pool (retries) |
| `realtime.integration.test.js` | Socket authentication, per-player room state, disconnect grace period |
| `rooms.integration.test.js`, `roomManager.test.js` | Create / join / leave, codes, capacity, start prompt timers |
| `security.integration.test.js` | **Every endpoint** must refuse anonymous calls, missing CSRF tokens and foreign origins; no private data in responses; rate limits |
| `auth.*`, `profile.*`, `validators.*`, `env.test.js` ... | Sign-in, profile, input validation, configuration |
| Frontend `*.test.jsx` | Login / account creation, lobby, rooms, the game table, results and rematch, spectators, rules, profile |

## How the tests are written (so you can add more)

- **Nothing is mocked that can be real.** The backend integration tests use the real app, real MySQL and real sockets; only Google is replaced by a fake that returns a chosen identity.
- **Time is injectable.** Room and game managers take `setTimer`/`now`, so timer behaviour is tested without waiting. The slower integration tests use very short real timers.
- **Decks are injectable.** `makeDeck` lets a test play a known deck, so the result never depends on luck. `targetScore` lets a match end after one round.
- **Test the rule, not the code.** Expected values (scores, points, who becomes host) are written by hand from the rules document, never computed by the same function under test.
- **Mutation spot-checks.** After writing tests for an important rule, temporarily break the rule (for example "always promote a new host") and confirm a test fails, then put it back. This is how weak tests were found and replaced during development.

## What is NOT covered by automatic tests

- A real Google sign-in (needs your own OAuth client; see doc 10).
- Real browsers: the screens were checked with screenshots at phone and desktop width (Phase 8) but there is no automated Chromium / Firefox / Safari run.
- Many simultaneous players (load testing).
- A reverse proxy / HTTPS deployment.
