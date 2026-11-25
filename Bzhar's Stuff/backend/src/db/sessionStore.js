import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';

const MySQLStore = MySQLStoreFactory(session);

// Login sessions are kept in MySQL (table `sessions`, created automatically on first
// start), so users stay logged in across backend restarts. This is an infrastructure
// table, not one of the five domain entities. Expired sessions are purged periodically.
//
// The table is created asynchronously, so this function is async and resolves only once
// the store is ready. Without that wait, the very first request on a brand-new
// database could arrive before the table exists and fail.
export async function createMySqlSessionStore(pool, config) {
  const store = new MySQLStore(
    {
      expiration: config.session.maxAgeMs,
      clearExpired: true,
      checkExpirationInterval: 15 * 60 * 1000,
      createDatabaseTable: true,
      schema: { tableName: 'sessions' },
    },
    pool
  );
  await store.onReady();
  return store;
}
