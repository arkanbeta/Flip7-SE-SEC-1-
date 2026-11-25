import { Router } from 'express';
import { createHealthRouter } from './health.js';
import { createAuthRouter } from './auth.js';
import { createAuthController } from '../controllers/authController.js';
import { createUsersRouter } from './users.js';
import { createUserController } from '../controllers/userController.js';
import { createRoomsRouter } from './rooms.js';
import { createRoomController } from '../controllers/roomController.js';
import { createCsrfProtection } from '../middleware/csrf.js';
import { createRateLimiters } from '../middleware/rateLimiters.js';

// Every API route is mounted here and ends up under /api.
export function createApiRouter({ config, pool, sessionMiddleware, userService, authService, profileService, roomService, logger }) {
  const router = Router();

  // Health checks need no login session.
  router.use('/health', createHealthRouter({ pool }));

  // Everything below runs with the login session loaded, and default-deny CSRF
  // protection: any POST/PUT/PATCH/DELETE must carry a valid X-CSRF-Token.
  router.use(sessionMiddleware);
  router.use(createCsrfProtection({ allowedOrigin: config.clientOrigin }));

  const limiters = createRateLimiters(config);
  const authController = createAuthController({ config, authService, userService, logger });
  router.use('/auth', createAuthRouter({ controller: authController, limiters }));

  const userController = createUserController({ userService, profileService });
  router.use('/users', createUsersRouter({ controller: userController, limiters }));

  const roomController = createRoomController({ roomService });
  router.use('/rooms', createRoomsRouter({ controller: roomController, limiters }));

  return router;
}
