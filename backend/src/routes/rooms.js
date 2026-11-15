import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';

export function createRoomsRouter({ controller, limiters }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/modes', controller.listModes);
  router.get('/current', controller.current);
  // Creating and joining are rate limited: joining is a code-guessing target.
  router.post('/', limiters.auth, controller.create);
  router.post('/join', limiters.auth, controller.join);
  router.post('/current/leave', limiters.action, controller.leave);
  router.post('/current/remove', limiters.action, controller.remove); // host only: kick or ban
  router.post('/current/start', limiters.action, controller.start);
  router.post('/current/start-response', limiters.action, controller.startResponse);
  router.post('/current/game/action', limiters.action, controller.gameAction);
  router.post('/current/ready', limiters.action, controller.ready);
  router.post('/current/rematch', limiters.action, controller.rematch);
  return router;
}
