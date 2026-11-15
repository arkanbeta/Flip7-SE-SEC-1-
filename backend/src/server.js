// Loads backend/.env into process.env. Must be the first import.
import 'dotenv/config';
import http from 'node:http';
import { loadConfig } from './config/env.js';
import { createPool } from './db/pool.js';
import { verifyDatabase } from './db/verify.js';
import { createMySqlSessionStore } from './db/sessionStore.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime/socketServer.js';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.db);

  // Refuse to start against a wrong or empty database.
  const { version } = await verifyDatabase(pool);
  console.log(`Connected to MySQL ${version} (database "${config.db.database}")`);

  // Logins are stored in MySQL so they survive restarts.
  const sessionStore = await createMySqlSessionStore(pool, config);

  const app = createApp({ config, pool, sessionStore });

  // Live room state is in memory and is now empty, so every stored room is stale.
  const removed = await app.locals.roomService.clearAllRooms();
  if (removed > 0) console.log(`Removed ${removed} stale room(s) left from before the restart.`);

  // We create the HTTP server ourselves (instead of app.listen) so Socket.IO can share it.
  const server = http.createServer(app);
  app.locals.realtime = attachRealtime({
    httpServer: server,
    config,
    sessionMiddleware: app.locals.sessionMiddleware,
    roomService: app.locals.roomService,
    manager: app.locals.roomManager,
  });

  server.listen(config.port, () => {
    console.log(`Backend listening on http://localhost:${config.port} (${config.nodeEnv})`);
  });

  // Close cleanly on Ctrl+C or when a host stops the process.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      app.locals.realtime.close();
      app.locals.gameManager.shutdown();
      app.locals.roomManager.shutdown();
      sessionStore.close();
      await pool.end();
      process.exit(0);
    });
    // Do not hang forever if a connection refuses to close.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Failed to start the backend:', error.message);
  process.exit(1);
});
