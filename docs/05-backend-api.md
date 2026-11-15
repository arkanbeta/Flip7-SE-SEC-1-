# 05 - Backend API

All endpoints live under `/api`. Responses are JSON. This page covers what exists so far (health and authentication); each later phase adds its endpoints here.

## Conventions

**Errors** always have the same shape:

```json
{ "error": { "code": "NICKNAME_TAKEN", "message": "That nickname is already taken." } }
```

`code` is stable and meant for the frontend to switch on; `message` is safe to show. Validation errors add `details: { "field": "nickname" }`.

**Authentication** is a server-side session. The browser holds only an opaque, `HttpOnly` cookie named `flip7.sid`; JavaScript on the page cannot read it. The user id is read **only from that session**, never from the request.

**CSRF:** every `POST`/`PUT`/`PATCH`/`DELETE` must send the header `X-CSRF-Token` with the value from `GET /api/auth/me`. Without it the answer is `403 CSRF_INVALID`. This rule is applied to the whole API by default, so a new endpoint is protected automatically.

**Status codes used:** 200/201/204 success - 302 browser redirects (OAuth) - 400 invalid input - 401 not signed in - 403 forbidden (including CSRF) - 404 unknown route - 409 conflict (already exists) - 413 body too large - 429 rate limited - 502 Google failed - 503 database unreachable.

## Health

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | none | `{ "status": "ok" }` while the server runs |
| GET | `/api/health/db` | none | `{ "status": "ok", "database": "up" }`, or 503 `DATABASE_UNAVAILABLE` |

## Authentication

| Method | Path | Auth / CSRF | Rate limit | Description |
| --- | --- | --- | --- | --- |
| GET | `/api/auth/google?intent=login\|register` | none | auth | Browser navigation. Starts sign-in and redirects (302) to Google |
| GET | `/api/auth/google/callback` | none | auth | Where Google sends the browser back. Redirects (302) to the frontend |
| GET | `/api/auth/me` | none | - | Who am I? Also returns the CSRF token |
| GET | `/api/auth/nickname-available?nickname=` | session (signed in or pending) | lookup | Is this nickname free? (advisory only) |
| POST | `/api/auth/register` | pending Google sign-in + CSRF | auth | Creates the account from nickname + avatar |
| POST | `/api/auth/logout` | CSRF | - | Destroys the session (204) |

Rate limits are per client IP per 15 minutes: **auth** = `AUTH_RATE_LIMIT_MAX` (default 30); **lookup** = four times that. Exceeding them returns `429 RATE_LIMITED`.

### `GET /api/auth/me`

Never an error for visitors. Three possible answers:

```json
{ "user": null, "pendingProfile": null, "csrfToken": null }            // visitor
{ "user": null, "pendingProfile": { "email": "a@b.c" }, "csrfToken": "..." }   // Google ok, nickname/avatar still to choose
{ "user": { "id": 1, "email": "...", "nickname": "Maya_1", "avatar": "fox",
            "totalPoints": 0, "createdAt": "..." }, "pendingProfile": null, "csrfToken": "..." }
```

The user object is built from an explicit list of fields; `google_id` is never sent to the browser.

### `POST /api/auth/register`

Body: `{ "nickname": "Maya_1", "avatar": "fox" }`.

- **Nickname:** 3-20 characters; letters (any language), digits, `_` or `-`; no spaces. Whitespace is trimmed and Unicode normalised (NFC).
- **Avatar:** must be one of the ids in `backend/src/utils/avatars.js`.
- `201` + `{ user, csrfToken }` when the account is created. `200` if a parallel request had just created the same Google account (you are signed in to that one; **no duplicate is made**).
- Errors: `400 VALIDATION_ERROR` - `403 NO_PENDING_REGISTRATION` (no Google sign-in waiting, or it expired after 15 minutes) - `403 CSRF_INVALID` - `409 NICKNAME_TAKEN` - `409 EMAIL_IN_USE`.

## Profile (all need a signed-in user; the user is always the one in the session)

| Method | Path | CSRF | Description |
| --- | --- | --- | --- |
| GET | `/api/users/me` | - | `{ user, stats: { matchesPlayed, totalHits, totalBusts } }` |
| GET | `/api/users/me/matches?limit=10` | - | `{ matches: [...] }` newest first; `limit` is 1-50 (default 10) |
| PATCH | `/api/users/me` | required | Change `nickname` and/or `avatar` |

Each match item: `matchId, gameMode, finishedAt, numberOfRounds, finalPoints, rankingPoints, hits, busts`.

**Statistics are derived, never stored:** they are `COUNT`/`SUM` queries over the player's own `MatchPlayers` rows (joined to `MatchHistories` and `GameModes`), so they cannot get out of sync and need no extra columns. Abandoned matches have no `MatchPlayers` rows and so never appear. Cumulative ranking points are `Users.total_points`.

**`PATCH /api/users/me` is a strict allowlist.** Any field other than `nickname` or `avatar` (`email`, `totalPoints`, `user_id`, `google_id`, ...) is refused with `400 VALIDATION_ERROR`; the email message explains that it comes from Google. A nickname already used by someone else gives `409 NICKNAME_TAKEN` (checked by the database `UNIQUE` constraint, so two racing requests are safe); changing the capitalisation of your *own* nickname is allowed. There is deliberately no `/users/:id` route, so one player cannot edit another.

## Rooms (Phase 4; all need a signed-in user, POSTs need the CSRF header)

The user always comes from the session, never from the request body. Every room response has the shape `{ room }` where `room` is:
`code, status ('Waiting' | 'In Progress'), game, gameMode {id,name}, maxPlayers, minPlayers (3), playerCount, creatorId, isCreator, canStart, players[{id,nickname,avatar,isCreator}], startPrompt, nextPromptAt, serverNow, version`. `startPrompt` (`{autoStartAt}`) and `nextPromptAt` are only filled for the creator. Times are milliseconds since 1970 on the server's clock; use `serverNow` to correct for clock differences.

| Endpoint | What it does | Errors |
|---|---|---|
| `GET /api/rooms/modes` | Predefined game modes (Normal only for now) | |
| `GET /api/rooms/current` | The room you are in, or `{ room: null }` | |
| `POST /api/rooms` `{gameModeId, maxPlayers 3-7}` | Create a room and become its creator (201) | 400 validation, 409 `ALREADY_IN_OTHER_ROOM` (`details.code` = that room), 503 `ROOM_CODE_UNAVAILABLE` |
| `POST /api/rooms/join` `{code}` | Join by code (case and spaces ignored). Joining your own room again is harmless | 400 `INVALID_ROOM_CODE`, 404 `ROOM_NOT_FOUND`, 409 `ROOM_FULL`, `ALREADY_IN_OTHER_ROOM`. Joining a room whose match is running makes you a spectator (until the next match) as long as there is a free seat |
| `POST /api/rooms/current/leave` `{confirm?: true}` | Leave. Returns `{ closed }`. While a match is running it needs `confirm: true` (leaving then means 0 points) | 404 `NOT_IN_ROOM`, 409 `LEAVE_CONFIRMATION_REQUIRED` |
| `POST /api/rooms/current/ready` `{ready: boolean}` | Results screen only: say whether you want another match. When every remaining player (3 or more) is ready a new match starts. Rate limited like game moves. Returns `{ room }` | 400 validation, 404 `NOT_IN_ROOM`, 409 `MATCH_NOT_OVER` |
| `POST /api/rooms/current/rematch` | Host only, results screen: start the next match with the players who are ready (3 needed, the host counts). The others watch. Returns `{ room }` | 403 `NOT_CREATOR`, 409 `MATCH_NOT_OVER`, `NOT_ENOUGH_PLAYERS` |
| `POST /api/rooms/current/game/action` `{type, decisionId, targetId?}` | One game move: `hit`, `stay`, or `target` / `gift` with a `targetId`. Rate limited per player (30 per 10 s). Returns `{ room }` | 400 validation, 409 `NOT_YOUR_TURN`, `STALE_MOVE`, `INVALID_MOVE`, `GAME_NOT_RUNNING` |
| `POST /api/rooms/current/start` | Creator starts now (needs 3+ players) | 403 `NOT_CREATOR`, 409 `NOT_ENOUGH_PLAYERS`, `ROOM_NOT_WAITING` |
| `POST /api/rooms/current/start-response` `{answer: 'yes'|'no'}` | Answer the start question | 403, 409 `NO_PENDING_PROMPT` |

**Room codes** are 6 characters from an alphabet without look-alikes, made with `crypto.randomInt`. Uniqueness is decided by the database UNIQUE constraint on `room_code` (case-insensitive collation): on a duplicate the server draws another code, up to 10 times, then answers 503. Two simultaneous requests can therefore never share a code.

**Start prompt:** asked when the 3rd player arrives. "Yes" starts. "No" (Not yet) postpones; the question is asked again after the full delay, forever. No answer starts the game automatically after the delay (`ROOM_START_PROMPT_SECONDS`, default 120). Dropping below 3 players cancels it; reaching 3 again asks afresh.

**Leaving:** the creator leaving a waiting room terminates it (row deleted, everyone removed). During a match ownership passes to the longest-present remaining player. The last player leaving deletes the room. On startup all leftover `GameRooms` rows are removed (rooms live in memory, so a restart ends them).

The waiting room learns about changes over Socket.IO (doc 06). `GET /api/rooms/current` is still used for the first load and as a fallback while the live connection is down.

## The sign-in flow, step by step

```
Browser                      Backend                         Google
  |  click "Continue"          |                                |
  |--- GET /api/auth/google -->|  make random state + nonce,    |
  |                            |  keep them in the SESSION      |
  |<-- 302 to Google ----------|                                |
  |-------------------------------- sign in, approve ---------->|
  |<------------------------------- 302 back with ?code&state --|
  |--- GET .../callback ------>|  1. state must equal the one stored (single use, 10 min)
  |                            |  2. swap code for tokens  ----->|  (uses the client SECRET,
  |                            |<------ ID token ---------------|   server to server)
  |                            |  3. verify token: signature, audience, expiry, nonce
  |                            |  4. email must be verified by Google
  |                            |  5. look up Users by google_id
  |<-- 302 /lobby  (existing) -|  -> new session id + CSRF token
  |<-- 302 /create-account/profile (new) -|  -> identity waits in the session, no Users row yet
  |--- POST /api/auth/register |  insert Users row (UNIQUE constraints guard duplicates)
```

Why each safeguard exists:

| Safeguard | Attack it stops |
| --- | --- |
| Random `state`, stored in the session, single use | Login CSRF: an attacker making your browser finish *their* sign-in |
| `nonce` inside the ID token | Replaying a stolen ID token |
| Token verification with our client id as audience | Tokens issued to some other app |
| Client secret used only server to server | Secret theft from the browser |
| New session id on login | Session fixation |
| `HttpOnly` + `SameSite=Lax` (+ `Secure` in production) cookie | Script theft of the cookie; cross-site POSTs |
| Unverified Google emails refused | Claiming an address you do not own |
| Identity kept server-side until nickname/avatar chosen | The browser forging "I am Google user X" in the registration form |

The login page and the create-account page use the same callback, so the outcome depends on the **account**, not the page: an existing Google account always signs in (never duplicated), and an unknown one is taken to the nickname/avatar step (the Login page adds `?from=login` so the frontend can explain why).

## Callback failures

Because the callback is a browser navigation, failures redirect to `/login?error=CODE` instead of returning JSON. Codes: `OAUTH_ACCESS_DENIED` (pressed Cancel), `OAUTH_STATE_INVALID` (expired, replayed or started elsewhere), `GOOGLE_AUTH_FAILED`, `GOOGLE_EMAIL_UNVERIFIED`, `EMAIL_IN_USE`. The frontend maps each to a friendly sentence and never displays the raw value.

## Account rules worth knowing

- The email is copied from Google at account creation and **never updated afterwards**, even if the Google email later changes.
- Accounts are keyed by Google's permanent user id (`sub`), not by email.
- If a *different* Google account arrives with an email that is already registered, sign-in is refused with `EMAIL_IN_USE` rather than merging accounts.
- A session that points to a deleted user is ended automatically on the next `/me`.


### Room state additions (Phase 7)

The room object also carries `matchOver` (the results screen is showing), `readyIds` (players who pressed Play again) and `canRematch` (3 or more players are still here). `isSpectator` (you are only watching), `canStartWithReady` (host only: the rematch button works) and `players[].isSpectator` are also sent. `creatorId` can name a player who has left, between the creator leaving on the results screen and the next match.
