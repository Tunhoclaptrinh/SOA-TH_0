import express from 'express';
import { jsonErrors } from '../shared/errors.js';
import { createServer } from '../shared/server.js';
import { BankClient } from './bank-client.js';
import { feeRoutes } from './routes.js';
import { PaymentService } from './service.js';
import { FeeStore } from './store.js';
import type { FeeOptions } from './types.js';

export function createFee(options: FeeOptions = {}) {
  const bank = options.bankClient ?? new BankClient(options);
  const service = new PaymentService(new FeeStore(), bank, options.logger ?? console.log);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use(feeRoutes(service));
  jsonErrors(app, { payment: true });
  return { app, server: createServer(app), close: () => bank.close() };
}
