# 02 - Architecture

## The four moving parts

```
  Browser (React + Vite)
     |   HTTP (REST, JSON, session cookie)        WebSocket (Socket.IO, Phase 5)
     v                                                |
  Express backend  <-------------------------------->-+
     |   SQL (mysql2, parameterized)
     v
  MySQL database
```

| Part | Responsibility | Never does |
| --- | --- | --- |
| **Frontend** | Displays state, collects input, animates cards | Decides rules, scores, turns, or permissions |
| **Backend (REST)** | Login, profile, creating/joining rooms, history | Trusts a user id sent by the browser |
| **Real-time server (Socket.IO)** | Live room updates and gameplay events | Contains game rules (those live in the game engine) |
| **MySQL** | Permanent data: users, rooms, match history | Holds live gameplay state |

**The backend is authoritative.** The browser only *asks* ("I want to flip a card"); the server validates and decides, then broadcasts the official state.

### Two kinds of state

- **Permanent (MySQL):** users, match histories, match results, ranking points, and the list of active room codes (`GameRooms`).
- **Temporary (server memory):** who is currently in a room, ready flags, start-prompt timers, reconnect timers, and the running game. This is planned as a `RoomManager` behind a small interface so Redis can replace it later.

**Known limitation:** memory is lost when the backend restarts. On startup the backend will delete all `GameRooms` rows (Phase 4/5) because every in-memory room is gone. Running more than one backend instance also needs Redis first.

## Backend layering

```
routes  ->  controllers  ->  services  ->  db
(URLs)      (HTTP in/out)    (business      (SQL)
                              rules)
```

- **routes/** map a URL to a controller function.
- **controllers/** read the request, call a service, send the response. No business rules.
- **services/** hold the actual rules (e.g. "a room cannot exceed `max_players`"). Added from Phase 2.
- **db/** is the only place that knows about MySQL connections.
- **game/** (Phase 6) is pure JavaScript with no Express or Socket.IO imports, so it can be tested alone and its rules changed without touching the networking.

### Dependency injection (`createApp({ config, pool })`)

`app.js` builds the Express app but does not start it, and receives its config and database pool as arguments. This lets tests inject a fake pool without a database, while `server.js` supplies the real one. `server.js` creates the HTTP server itself so Socket.IO can attach to it in Phase 5.

### Configuration

`config/env.js` reads and validates every environment variable once. Nothing else reads `process.env`. Missing or malformed values stop the backend at startup with a message naming the variable.

### Errors

Expected problems are thrown as `AppError(status, code, message)`. The central handler turns them into

```json
{ "error": { "code": "ROOM_FULL", "message": "This room is full." } }
```

Unexpected errors are logged in full on the server, but the client only receives a generic 500, so SQL text, hostnames, and stack traces never leak. Express 5 forwards errors from `async` handlers automatically, so controllers need no try/catch wrappers.

### Startup checks (`db/verify.js`)

Before listening, the backend confirms: MySQL (not MariaDB) at version 8.0.16 or newer, and all five tables exist. A wrong setup fails immediately with an actionable message.

### Transactions (`db/transaction.js`)

`withTransaction(pool, async (conn) => { ... })` commits if the function returns and rolls back everything if it throws. It will be used to save a finished match and add ranking points as one all-or-nothing step.

## Security foundations already in place

- **Helmet** sets protective HTTP headers.
- **CORS** allows only `CLIENT_ORIGIN` (with credentials). Other origins receive no CORS headers.
- **Body limit** of 10 kB on JSON requests.
- **Least-privilege DB user** (documented in the README) instead of `root`.
- **Parameterized queries only**; `multipleStatements` is off.
- **No secrets in the frontend.** Only `VITE_` variables reach the browser, and none are secret.

### Added in Phase 2

- **Sessions in MySQL** (`express-session` + `express-mysql-session`): the browser holds an opaque `HttpOnly` cookie; the data lives in the `sessions` table, so logins survive backend restarts. A fresh session id is issued at login (session-fixation defence).
- **CSRF protection, default-deny:** every non-GET request under `/api` needs the `X-CSRF-Token` header (token stored in the session, learned via `GET /api/auth/me`), and a browser `Origin` header, if present, must be our frontend. Because it is applied in `routes/index.js` to everything after the session middleware, new endpoints are protected automatically.
- **Rate limiting** (`express-rate-limit`) on sign-in, the OAuth callback, account creation, and nickname lookups. In-memory per IP: fine for one backend instance.
- **Google OAuth** with `state`, `nonce` and server-side ID-token verification; see `05-backend-api.md` for the step-by-step flow and what each safeguard stops.
- **Server-side validation** (`validators/`) of every input, including an avatar allowlist.
- **Startup rules:** production requires HTTPS URLs and a strong, non-placeholder session secret.

Remember that **CORS does not stop forged requests from being processed**; the CSRF middleware does.

### Where the "pending" Google identity lives

Between "Google confirmed who you are" and "you chose a nickname", the verified `google_id` and email wait **in the server-side session**, never in the browser. `POST /api/auth/register` reads them from there, so a browser cannot claim to be a different Google user.

### Ordering matters in `app.js` / `routes/index.js`

`helmet` -> `cors` -> JSON body parser -> (health routes) -> session -> CSRF check -> auth routes -> 404 -> error handler.

## Frontend structure

- `app/` - bootstrapping, the router (routes are plain data so tests can mount them), and `AuthProvider`, which mirrors what `GET /api/auth/me` last said.
- `services/api.js` - the only code that calls `fetch`. It sends cookies, attaches the CSRF token (kept in memory, never in `localStorage`) to non-GET requests, turns failures into `ApiError` (with the backend's `code`), and reports network failures cleanly.
- `components/RouteGuards.jsx` - `ProtectedRoute` / `PublicOnlyRoute`. These only decide what the browser *shows*; the backend independently refuses every protected request.
- `styles/variables.css` - design tokens (palette from the specification, spacing, radii). All components use these variables.
- In development, Vite proxies `/api` to the backend, so the browser sees one origin.
- `global.css` respects `prefers-reduced-motion` globally.
