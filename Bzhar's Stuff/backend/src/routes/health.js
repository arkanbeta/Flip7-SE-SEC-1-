import { Router } from 'express';
import { createHealthController } from '../controllers/healthController.js';

export function createHealthRouter({ pool }) {
  const router = Router();
  const controller = createHealthController({ pool });

  router.get('/', controller.getStatus);
  router.get('/db', controller.getDatabaseStatus);

  return router;
}
