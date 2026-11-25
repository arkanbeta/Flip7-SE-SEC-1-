import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';

export function createUsersRouter({ controller, limiters }) {
  const router = Router();
  router.use(requireAuth); // everything about /users/me needs a signed-in user
  router.get('/me', controller.getMe);
  router.get('/me/matches', controller.getMyMatches);
  router.patch('/me', limiters.auth, controller.updateMe);
  return router;
}
