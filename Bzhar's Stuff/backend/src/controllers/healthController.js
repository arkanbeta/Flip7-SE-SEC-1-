import { AppError } from '../utils/AppError.js';

// Controllers translate HTTP <-> application: read the request, call a service,
// send the response. They contain no business rules. (Health checks are so
// small they need no service layer.)
export function createHealthController({ pool }) {
  return {
    // "Is the server process up?"
    getStatus(req, res) {
      res.json({ status: 'ok' });
    },

    // "Can the server reach MySQL?" Useful for deployment checks.
    // Express 5 forwards errors from async handlers to the error middleware.
    async getDatabaseStatus(req, res) {
      try {
        await pool.query('SELECT 1');
      } catch (error) {
        console.error('Database health check failed:', error.message);
        throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not reachable.');
      }
      res.json({ status: 'ok', database: 'up' });
    },
  };
}
