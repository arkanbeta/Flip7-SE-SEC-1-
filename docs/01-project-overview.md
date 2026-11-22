# 01 - Project overview

## What this project is

Flip 7 Online lets friends play Flip 7 together in a browser. One player creates a private room and gets a short **room code**; others join with that code; the creator starts the game when at least three players are present (maximum seven, chosen by the creator).

## Scope and deliberate limits

| Included | Not included (by design) |
| --- | --- |
| Google sign-in and account creation | Passwords or any other login method |
| Private rooms joined by room code | Random matchmaking or public player matching |
| One predefined mode: **Normal** | User-created game modes |
| Profile with stats and match history | Statistics that depend on rules not yet supplied |
| Real-time play over Socket.IO | A game engine or Redis (until rules / scaling require them) |

The room player limits are fixed: **minimum 3**, **maximum 12**. The creator picks the capacity (3-12); the minimum is not configurable.

## Roadmap

| Phase | Goal | Status |
| --- | --- | --- |
| 1 | Foundation: structure, config, MySQL connection, startup checks | **Done** |
| 2 | Google OAuth, sessions, CSRF, rate limiting, login / create-account | **Done** (real Google sign-in not yet tried, see doc 10) |
| 3 | Lobby, profile, rules page, design system | **Done** |
| 4 | Rooms: unique codes, create/join/leave, waiting room, start prompt | **Done** |
| 5 | Socket.IO: authenticated connections, real-time room state, disconnect grace period | **Done** (see doc 06) |
| 6 | Game engine: rules, 15 s turn timer, game screen, leave confirmation | **Done** (doc 11) |
| 7 | Match results, ranking points, ready system, rematches | **Done** (doc 11) |
| 8 | Final testing, polish, security review | **Done** (docs 07, 09, 12) |

## Rules that must never be guessed

The Flip 7 rules come from the project owner's document and are implemented as written (doc 11). Where that document is silent, the choice is marked `[OPEN]` in the code and listed in doc 11 for the owner to confirm; nothing is silently invented.

## Decisions made so far

These were proposed and approved before Phase 1:

1. **Session storage in MySQL.** One extra infrastructure table, `sessions`, is created automatically by the session store (Phase 2). It is not a domain entity.
2. **Duplicate match completion** is prevented by an in-memory `finalized` flag plus a database transaction. This is correct for a single backend instance; running several instances would need a database-level match token (the schema would then need a new column and re-approval).
3. **Creator leaves:** the outcome depends on the match state (refined by the project owner):
   - **Match not started** (waiting room, including a pending start prompt): the room is **terminated** and its `GameRooms` row deleted.
   - **Match in progress:** ownership **transfers** to the longest-present remaining player (`GameRooms.creator_id` is updated). If nobody remains, the room is deleted (and the match is `Abandoned`).
   "Leaves" means an intentional leave, a log-off, or a disconnect that outlasts the reconnect grace period.
4. **Two-stage Google registration:** the Google callback only proves identity. A `Users` row is created after the player picks a nickname and avatar, because both columns are `NOT NULL`.
5. **Avatars:** 12-16 original SVG avatars; the backend validates the stored identifier against an allowlist.

The supplied schema (five entities) is unchanged.

### Implementation choices that differ from the original plan

- **Google library:** `google-auth-library` (Google's own client) instead of `passport-google-oauth20`. We only need the authorization-code handshake and ID-token verification, and Passport's session machinery would duplicate what `express-session` already does.
- **CSRF:** a small built-in "synchronizer token" check (`middleware/csrf.js`, about 30 lines, token kept in the server session) instead of the `csrf-csrf` package. It is easier to read and to test, and it needs no extra cookie or dependency.
- **Avatars were built in Phase 2** (not Phase 3), because choosing one is part of account creation. There are 14, in `frontend/src/assets/avatars/`.
- **Temporary lobby:** `/lobby` currently shows only the signed-in user and a Log out button. Phase 3 replaces it with the real lobby.

## Decisions on earlier open questions

- **Start prompt loop:** if the creator answers "No", the server asks again after 2 minutes, and keeps asking indefinitely until the creator says Yes (or the 2-minute no-response auto-start applies). If the creator logs off, the game does not happen and the room is terminated.
- **Everyone but one leaves mid-match (Phase 7):** the match is completed with the remaining player as winner, and **every player who took part gets a `MatchPlayers` row, including those who left**, because the match had started. A leaver's `final_points` and `ranking_points` are **0**.
- **Everyone leaves mid-match:** recorded as `Abandoned`, with no `MatchPlayers` rows and no ranking points (unchanged from the specification).

## Decision: creator leaves on the post-game results screen (Phase 7)

The match is finished and its points are saved, so the room is **not** terminated and ownership is **not** transferred at that moment. Only if the remaining players go on to another game without the former creator does ownership pass to the longest-present remaining player (the first who joined). Built in Phase 7 together with the ready/rematch system (doc 11).

## Decisions for Phase 7 (answered by the project owner)

- The host can start the next match with only the players who are ready; the others watch it.
- People can join with the code while a match is running and **spectate** until the next match, unless the room is full (then they cannot join at all).

## Rules received

The Flip 7 rules arrived as `Flip_7_Complete_Rules_and_Online_Project_Notes.pdf` (Op Games Ruleset 3.1). They are on the Rules page and are implemented by the Phase 6 engine. The PDF's own section F lists items it leaves to the project owner; those are tracked below.

## Decisions for Phase 6 (answered by the project owner)

- **Ranking points** are simply the points earned in the game when it finishes.
- **A player who leaves mid-match gets nothing**, so leaving a running match requires a confirmation (screen dialog plus a server-side check).
- **Each turn is timed: 15 seconds.** No answer means an automatic Stay. If the time runs out while choosing who gets a Freeze / Flip Three, it goes to a random player, the holder included.

## Questions still open

- **Disconnects:** may a player rejoin after disconnecting, and what happens if they do not return (Phase 5 will use a configurable grace period until you decide).
- **Spectators** and **match-history detail:** not supported / as already built, unless you say otherwise.
- **Game choices I made where the rules are silent** (random first dealer, the winner when everyone else leaves): listed in doc 11 for you to confirm.
