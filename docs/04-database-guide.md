# 04 - Database guide

The file `backend/src/db/schema.sql` is the **source of truth**. This guide explains it; it does not replace it. The schema has five domain entities and is unchanged. (A sixth infrastructure table, `sessions`, is created automatically by the session store in Phase 2.)

## Tables and relationships

```
Users (1) ---< MatchPlayers >--- (1) MatchHistories >--- (1) GameModes
  |                                                           |
  +---< GameRooms (creator_id) >------------------------------+ (game_mode_id)
```

| Table | Holds | Notes |
| --- | --- | --- |
| `Users` | One row per Google account | `google_id`, `email`, `nickname` are each `UNIQUE`. `total_points` is the cumulative ranking points. |
| `GameModes` | Predefined modes | Seeded with `Normal`. Adding a mode = inserting a row + a code module. Users can never add modes. |
| `GameRooms` | **Active** rooms only | `room_code` is `UNIQUE`; `max_players` has `CHECK (3..7)`; `status` is `Waiting` or `In Progress`. Rows are deleted when a room empties. |
| `MatchHistories` | One row per finished match | `status` is `Completed` or `Abandoned`. Inserted only at the end of a match. |
| `MatchPlayers` | One row per player per completed match | `UNIQUE (match_id, user_id)`; holds final points, ranking points, hits, busts. Not created for abandoned matches. |

All foreign keys use `ON DELETE RESTRICT`, so history can never silently disappear. For example, a `Users` row cannot be deleted while it has match results.

## Why the database guards the important rules

The application checks rules first (friendly errors), but the database is the **last line of defence**:

- **Room codes:** two simultaneous requests may generate the same code. Both pass an in-app check, but `UNIQUE (room_code)` lets only one `INSERT` succeed; the other gets `ER_DUP_ENTRY`, and the service generates a new code and retries.
- **Nicknames:** same technique with `UNIQUE (nickname)`.
- **Capacity:** `CHECK (max_players BETWEEN 3 AND 7)` rejects invalid values even if validation has a bug. Verified by an integration test (MySQL error 3819).
- **One result per player per match:** `UNIQUE (match_id, user_id)`.

## The `sessions` table (infrastructure, not a domain entity)

Login sessions live in a table named `sessions`, created automatically by `express-mysql-session` the first time the backend starts. It is why the `flip7_app` database user needs the `CREATE` privilege. Rows expire automatically and are purged every 15 minutes. `createMySqlSessionStore` waits until the table exists before the server starts listening; without that wait, the first request on a brand-new database could fail (this was found and fixed by a test). Nothing in the application's own tables references it.

## Case and accent insensitivity

The collation `utf8mb4_0900_ai_ci` is **a**ccent-**i**nsensitive and **c**ase-**i**nsensitive:

- Nicknames "Alex" and "alex" count as the same, and so do "Jose" and "José". This prevents look-alike impersonation, so it is intentional. (Verified by the integration tests, which register such variants and get `409 NICKNAME_TAKEN`.)
- Room codes are case-insensitive. The backend will still store them in uppercase for consistency.

## Time

All `DATETIME(3)` values are **UTC**. The pool uses `timezone: 'Z'` and runs `SET time_zone = '+00:00'` on every new connection, so MySQL's `CURRENT_TIMESTAMP(3)` defaults and JavaScript `Date` objects agree. Convert to the user's local time only in the browser. This is verified by an integration test.

## Version requirement

MySQL **8.0.16 or newer**: earlier versions parse `CHECK` constraints but do not enforce them, and the `0900` collation is a MySQL 8 feature. MariaDB is not supported. `db/verify.js` enforces this at startup.

## Derived statistics (no extra columns)

Profile numbers come from queries, not stored counters:

- Matches played: `COUNT(*)` of the user's `MatchPlayers` rows
- Total hits / busts: `SUM(hits)` / `SUM(busts)` over those rows
- Match history: `MatchPlayers` joined to `MatchHistories` and `GameModes`
- Cumulative ranking points: `Users.total_points` (updated in the same transaction that saves the match, using `SET total_points = total_points + ?`, never read-then-write)

## Working with the database from code

```js
// Always parameterized. User input NEVER goes into the SQL text.
const [rows] = await pool.query('SELECT * FROM Users WHERE google_id = ?', [googleId]);

// Several writes that must all succeed or all fail:
await withTransaction(pool, async (conn) => {
  await conn.query('INSERT INTO MatchHistories (...) VALUES (?, ...)', [...]);
  await conn.query('UPDATE Users SET total_points = total_points + ? WHERE user_id = ?', [pts, id]);
});
```

## Duplicate match completion (single-instance design)

`MatchHistories` is written only when a match ends, so the database alone cannot tell that "this match" was already saved. The server therefore keeps a one-time `finalized` flag on the in-memory match and saves inside one transaction; a repeated completion event sees the flag and does nothing. This is sufficient for one backend instance. Multiple instances would need a unique match token stored in the database - a schema change that requires explicit approval.

## Cleanup on restart

`GameRooms` mirrors rooms that exist in server memory. If the backend restarts, memory is empty but the table is not, so all `GameRooms` rows are deleted at startup (implemented with the room system).

## Setup recap

See the README: run `schema.sql` once, create the `flip7_app` user with `SELECT, INSERT, UPDATE, DELETE, CREATE` on `flip7_online.*`, and put its password in `backend/.env`.
