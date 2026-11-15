import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createApiRouter } from './routes/index.js';
import { notFoundHandler, createErrorHandler } from './middleware/errorHandler.js';
import { createSessionMiddleware } from './config/session.js';
import { createUserService } from './services/userService.js';
import { createAuthService } from './services/authService.js';
import { createProfileService } from './services/profileService.js';
import { createMatchService } from './services/matchService.js';
import { createRoomService } from './services/roomService.js';
import { createRoomManager } from './realtime/roomManager.js';
import { createGameManager } from './game/gameManager.js';
import { createGoogleOAuthService } from './services/googleOAuthService.js';

// Builds the Express app WITHOUT starting a server. Everything external is passed in
// (dependency injection) so tests can supply fakes and server.js supplies the real ones:
//   config        validated settings        pool          MySQL pool
//   sessionStore  where sessions are kept (undefined = in-memory, tests only)
//   googleOAuth   the Google service (defaults to the real one)
//   roomManager   live room state (defaults to a new one; tests inject their own)
export function createApp({ config, pool, sessionStore, googleOAuth, roomManager, gameManager, generateRoomCode, logger = console }) {
  const app = express();

  // Behind a reverse proxy, trust it so req.ip and secure cookies are correct.
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  // Secure HTTP headers (CSP, no-sniff, frameguard, HSTS in production...).
  app.use(helmet());

  // CORS: only our own frontend may call the API from a browser, and cookies
  // are allowed only for that origin.
  // The origin callback sends CORS headers ONLY when the request's Origin matches;
  // for any other origin no CORS headers are sent, so the browser blocks the call.
  // (Requests without an Origin header - same-origin, curl - are unaffected.)
  // NOTE: CORS protects browsers reading responses; it does NOT stop a forged
  // request from being processed. That is what the CSRF middleware is for.
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, !origin || origin === config.clientOrigin);
      },
      credentials: true,
    })
  );

  // Small body limit: our JSON payloads are tiny, so large ones are rejected early.
  app.use(express.json({ limit: '10kb' }));

  const userService = createUserService(pool);
  const authService = createAuthService({
    userService,
    googleOAuth: googleOAuth ?? createGoogleOAuthService(config.google),
  });
  const profileService = createProfileService(pool);

  // Live room state + the database-facing room rules. The manager's timer calls back into
  // the service (to save an automatic start), hence the small `hooks` object.
  const manager = roomManager ?? createRoomManager({ startPromptMs: config.rooms.startPromptMs, logger });
  // Games: the rules engine plus the clocks (turn time limit, pause between rounds).
  const games = gameManager ?? createGameManager({ manager, turnMs: config.game.turnMs, roundEndMs: config.game.roundEndMs, logger });
  // Saving finished matches: the game manager reports a match once; the service writes it in
  // one transaction. The players keep seeing their results even if the save has to be retried.
  const matchService = createMatchService({ pool, logger });
  const alsoFinished = games.hooks.onFinished; // keep a hook that was injected (tests)
  const alsoAbandoned = games.hooks.onAbandoned;
  games.hooks.onFinished = (report) => {
    alsoFinished?.(report);
    const { room, result, startedAt, finishedAt } = report;
    matchService
      .saveCompleted({ gameModeId: room.gameModeId, startedAt, finishedAt, result })
      .catch((error) => logger.error(`Could not save the match of room ${room.code}:`, error));
  };
  games.hooks.onAbandoned = (report) => {
    alsoAbandoned?.(report);
    const { room, startedAt, finishedAt, rounds } = report;
    matchService
      .saveAbandoned({ gameModeId: room.gameModeId, startedAt, finishedAt, rounds })
      .catch((error) => logger.error(`Could not record the abandoned match of room ${room.code}:`, error));
  };
  app.locals.matchService = matchService;
  const roomService = createRoomService({ pool, manager, games, generateCode: generateRoomCode, logger });
  manager.hooks.autoStart = roomService.autoStart; // works for injected managers too
  app.locals.roomManager = manager;
  app.locals.roomService = roomService;
  app.locals.gameManager = games;
  const sessionMiddleware = createSessionMiddleware({ config, store: sessionStore });
  app.locals.sessionMiddleware = sessionMiddleware; // Socket.IO reads the same login session

  app.use(
    '/api',
    createApiRouter({ config, pool, sessionMiddleware, userService, authService, profileService, roomService, logger })
  );

  // These two MUST come last.
  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger }));

  return app;
}
