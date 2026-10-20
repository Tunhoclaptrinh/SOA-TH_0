import { Router } from 'express';
import { paymentController } from './controller.js';
import type { PaymentService } from './service.js';

export function feeRoutes(service: PaymentService): Router {
  const router = Router();
  const controller = paymentController(service);
  router.get('/health', (_req, res) => {
    res.json({ service: 'fee', status: 'UP' });
  });
  router.get('/students/:id/fees', controller.fees);
  router.post('/students/:id/payments', controller.create);
  router.get('/payments/:id', controller.payment);
  router.post('/payments/:id/retry', controller.retry);
  return router;
}
