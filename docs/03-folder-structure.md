# 03 - Folder structure

Every folder exists for a reason. Folders are created in the phase that first needs them, so there are no empty placeholders.

## Root

| Path | Purpose |
| --- | --- |
| `frontend/` | The React application (what runs in the browser) |
| `backend/` | The Express/Socket.IO server |
| `docs/` | This documentation |
| `README.md` | Setup and everyday commands |
| `.gitignore` | Keeps `node_modules`, builds and **secrets (`.env`)** out of Git |

## `backend/src/` (current)

| Path | Purpose |
| --- | --- |
| `server.js` | Entry point: load env, connect to MySQL, verify it, open the session store, start listening, shut down cleanly |
| `app.js` | Builds the Express app (security middleware, session, routes, error handling) without starting it |
| `config/env.js` | One place that reads and validates environment variables |
| `config/session.js` | Session middleware and cookie options (shared with logout) |
| `db/pool.js` | The shared MySQL connection pool (UTC, utf8mb4) |
| `db/transaction.js` | `withTransaction` helper (commit or roll back everything) |
| `db/verify.js` | Startup check of MySQL version and required tables |
| `db/sessionStore.js` | MySQL-backed login-session store (creates the `sessions` table) |
| `db/errors.js` | Recognises MySQL duplicate-key errors (used for nicknames now, room codes in Phase 4) |
| `db/schema.sql` | The supplied schema, unchanged (source of truth) |
| `middleware/errorHandler.js` | 404 handler and the central error-to-JSON handler |
| `middleware/csrf.js` | CSRF token + Origin check for state-changing requests |
| `middleware/requireAuth.js` | Guard for routes that need a signed-in user |
| `middleware/rateLimiters.js` | Per-IP request limits for sign-in and lookups |
| `routes/` | URL definitions (`index.js` mounts everything under `/api`) |
| `controllers/` | Handle HTTP requests; no business rules |
| `services/profileService.js` | Derived statistics and match history (SQL) |
| `controllers/userController.js`, `routes/users.js` | The `/api/users/me` endpoints |
| `validators/profileValidators.js` | Profile-update allowlist and `limit` validation |
| `services/googleOAuthService.js` | The only code that talks to Google |
| `services/authService.js` | Sign-in rules: state check, existing vs new account, registration |
| `services/userService.js` | All SQL for the `Users` table |
| `validators/authValidators.js` | Nickname and avatar validation |
| `utils/AppError.js` | Error type for expected failures |
| `utils/session.js` | Session helpers (new session at login, pending Google identity) |
| `utils/avatars.js` | The avatar allowlist |
| `tests/` | Vitest tests; `*.integration.test.js` need a real MySQL |

## `backend/src/` (added in later phases)

| Path | Added | Purpose |
| --- | --- | --- |
| `realtime/roomManager.js` | 4 | In-memory live rooms: members, status, start-prompt timers (synchronous, so every change is atomic) |
| `realtime/socketServer.js` | 5 | Authenticated Socket.IO server: pushes each player's room state, disconnect grace period |
| `services/roomService.js` | 4 | Joins the manager and the database (GameRooms rows, unique-code retry, auto-start save) |
| `validators/roomValidators.js`, `utils/roomRules.js`, `utils/roomCode.js` | 4 | Input checks, 3-7 limits, secure 6-character code generator |
| `controllers/roomController.js`, `routes/rooms.js` | 4 | Room endpoints |
| `services/matchService.js` | 7 | Saves a finished match (history, player rows, total points) in one transaction, with retries; records abandoned matches |
| `realtime/` | Phase 5 | Socket.IO setup, authentication, event handlers, `RoomManager` |
| `game/` | Phase 6 | The pure game engine and mode registry |

## `frontend/src/` (current)

| Path | Purpose |
| --- | --- |
| `main.jsx` | Mounts React; loads fonts, tokens, global styles |
| `app/` | `App.jsx` (providers, `MotionConfig`), `router.jsx` (routes as data), `AuthProvider.jsx` |
| `components/` | Reusable UI: Button, TextField, Avatar, AvatarPicker, Modal, Tabs, PageHeader, Page, PlayingCard, route guards, icons |
| `hooks/useAuth.js` | Access to the signed-in user from any component |
| `services/api.js` | All HTTP calls to the backend |
| `features/auth/` | Login, create account, nickname + avatar step |
| `features/lobby/` | Lobby and the Create/Join dialogs |
| `features/profile/` | Profile page, statistics, match history, edit dialog |
| `features/rules/` | Rules page, tabs and the rules data file |
| `utils/` | `avatars.js` (the avatar collection), `format.js`, `roomCode.js` |
| `assets/avatars/` | The 14 original SVG avatars (file name = id stored in the database) |
| `styles/` | `variables.css` (design tokens), `global.css` |
| `tests/` | Vitest + Testing Library tests |

## `frontend/src/` (added later)

| Path | Added | Purpose |
| --- | --- | --- |
| `features/rooms` | 4-5 | Waiting room page, live-state hook (Socket.IO, polling only as a fallback), countdown hook |
| `services/socket.js` | 5 | The only place a Socket.IO connection is opened |
| socket in `services/`, more `hooks/` | Phase 5 | Socket.IO client |
| `features/game` | Phase 6 | Table, cards, results |

`socket.io` / `socket.io-client` are installed with the real-time work (Phase 5), so nothing is installed unused.
