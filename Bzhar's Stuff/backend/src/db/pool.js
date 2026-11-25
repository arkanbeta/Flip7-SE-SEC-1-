import mysql from 'mysql2/promise';

// One shared connection pool for the whole backend. mysql2 opens connections
// lazily and reuses them, so we never create a connection per request.
//
// SECURITY: always pass user input as parameters (pool.query('... WHERE id = ?', [id])),
// never by building SQL strings. `multipleStatements` is left at its default
// (off) so an injected ";" cannot run a second statement.
export function createPool(dbConfig) {
  const pool = mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    connectionLimit: dbConfig.connectionLimit,
    waitForConnections: true,
    queueLimit: 0,
    charset: 'utf8mb4',
    // BIGINT UNSIGNED ids: return numbers while they are safe, strings beyond that.
    supportBigNumbers: true,
    // All DATETIME values are stored and read as UTC (see docs/04-database-guide.md).
    timezone: 'Z',
  });

  // Make MySQL's CURRENT_TIMESTAMP(3) defaults UTC too, on every new connection.
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });

  return pool;
}
