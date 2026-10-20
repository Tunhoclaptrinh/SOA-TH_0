import { Router } from 'express';
import { createChargeController } from './controller.js';
import type { ChargeService } from './service.js';
import type { BankStore } from './store.js';

export function bankRoutes(service: ChargeService, store: BankStore): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ service: 'bank', status: 'UP' });
  });
  router.get('/stats', (_req, res) => {
    res.json(store.stats);
  });
  router.post('/charges', createChargeController(service));
  return router;
}
