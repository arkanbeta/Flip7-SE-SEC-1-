# Flip 7 Online

A browser-based multiplayer version of the Flip 7 card game. Players sign in with Google, create or join **private rooms by room code**, and play in real time. There is no random matchmaking and users cannot create their own game modes.

**Status:** All 8 phases complete (foundation; Google sign-in; lobby, profile and rules pages; private rooms; real-time with Socket.IO; the Flip 7 game engine and game screen; saving matches and ranking points, ready system and rematches). Followed by polish, an accessibility and responsive audit and a security review. See [docs/01-project-overview.md](docs/01-project-overview.md) for the roadmap.

**Stack:** React + Vite (frontend) - Node.js + Express 5 (backend) - MySQL 8 - Socket.IO (real time) - Google OAuth 2.0.

## Prerequisites

- Node.js 20 or newer
- MySQL **8.0.16 or newer** (MariaDB is not supported: the schema relies on MySQL's CHECK constraints and collation)
- Git

## First-time setup

### 1. Create the database

The schema in `backend/src/db/schema.sql` is the source of truth. It creates the `flip7_online` database, the five tables and the initial "Normal" game mode. Run it **once**:

```bash
mysql -u root -p < backend/src/db/schema.sql
```

Then create a dedicated database user instead of letting the app use `root`:

```sql
CREATE USER 'flip7_app'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE ON flip7_online.* TO 'flip7_app'@'localhost';
```

`CREATE` is needed only so the login-session store can create its own `sessions` table.

### 2. Configure and start the backend

```bash
cd backend
cp .env.example .env      # then edit .env (see below)
npm install
npm run dev               # http://localhost:4000
```

In `backend/.env` you must set:

- `DB_PASSWORD` to the password you chose above.
- `SESSION_SECRET` to a long random value: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from your own Google OAuth client. Step-by-step instructions are in [docs/10-setup-requirements-and-compatibility.md](docs/10-setup-requirements-and-compatibility.md).

The backend refuses to start (with a clear message) if the environment variables are missing, MySQL is unreachable or too old, or the tables have not been created.

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

Open http://localhost:5173: you will land on the login page. In development Vite forwards `/api` requests to the backend, so the browser only ever talks to one origin.

## Everyday commands

| Where | Command | What it does |
| --- | --- | --- |
| `backend/` | `npm run dev` | Start the API with auto-restart |
| `backend/` | `npm test` | Run all backend tests |
| `frontend/` | `npm run dev` | Start the Vite dev server |
| `frontend/` | `npm test` | Run the frontend tests |
| `frontend/` | `npm run build` | Production build into `frontend/dist/` |

To also run the database integration tests, set `RUN_DB_TESTS=true` in `backend/.env`. They only create uniquely named temporary rows and delete them afterwards.

## Security reminders

- `.env` files are git-ignored. **Never commit real credentials.** Only `.env.example` files (placeholders) are committed.
- Anything in a `VITE_` variable ends up in public JavaScript. Secrets belong only in `backend/.env`.

## Documentation

All design decisions are explained in [`docs/`](docs/). Start with `01-project-overview.md`. **Required versions of Node, MySQL and every package are listed in [`docs/10-setup-requirements-and-compatibility.md`](docs/10-setup-requirements-and-compatibility.md).** Also: [07 testing guide](docs/07-testing-guide.md), [09 Git and GitHub guide](docs/09-git-and-github-guide.md), [11 game engine](docs/11-game-engine.md) and [12 security and quality review](docs/12-security-and-quality-review.md).
