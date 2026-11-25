// Startup check: fail early, with a clear message, if the database is not what
// the application expects. Much friendlier than a confusing error on the first
// request.

// The five domain tables from the supplied schema (names are case-sensitive on Linux).
export const REQUIRED_TABLES = ['Users', 'GameModes', 'MatchHistories', 'MatchPlayers', 'GameRooms'];

// CHECK constraints (room capacity 3-12) are only enforced from MySQL 8.0.16.
const MIN_VERSION = [8, 0, 16];

export function parseMysqlVersion(versionString) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(versionString);
  return match ? match.slice(1, 4).map(Number) : null;
}

function isOlderThan(version, minimum) {
  for (let i = 0; i < 3; i += 1) {
    if (version[i] !== minimum[i]) return version[i] < minimum[i];
  }
  return false;
}

export async function verifyDatabase(pool) {
  const [[{ version }]] = await pool.query('SELECT VERSION() AS version');

  if (/mariadb/i.test(version)) {
    throw new Error(
      `MariaDB (${version}) is not supported. Use MySQL ${MIN_VERSION.join('.')} or newer.`
    );
  }
  const parsed = parseMysqlVersion(version);
  if (!parsed || isOlderThan(parsed, MIN_VERSION)) {
    throw new Error(
      `MySQL ${version} is too old. Version ${MIN_VERSION.join('.')} or newer is required.`
    );
  }

  const [rows] = await pool.query(
    'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
  );
  // Compared case-insensitively: on Windows (and macOS) MySQL defaults to
  // lower_case_table_names=1/2 and reports "users" instead of "Users". Where names ARE
  // case-sensitive (Linux), a wrongly-cased table would still fail the queries themselves.
  const existing = new Set(rows.map((row) => row.name.toLowerCase()));
  const missing = REQUIRED_TABLES.filter((table) => !existing.has(table.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(
      `Database is missing tables: ${missing.join(', ')}. Load backend/src/db/schema.sql first.`
    );
  }

  return { version };
}
