import { Router } from 'express';

export function createAuthRouter({ controller, limiters }) {
  const router = Router();

  router.get('/google', limiters.auth, controller.googleStart);
  router.get('/google/callback', limiters.auth, controller.googleCallback);
  router.get('/dev', limiters.auth, controller.devLogin); // 404 unless DEV_LOGIN_ENABLED (never in production)
  router.get('/me', controller.me);
  router.get('/nickname-available', limiters.lookup, controller.nicknameAvailable);
  router.post('/register', limiters.auth, controller.register);
  router.post('/logout', controller.logout);

  return router;
}
