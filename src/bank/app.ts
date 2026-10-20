import express from 'express';
import { bankConfig } from '../shared/config.js';
import { jsonErrors } from '../shared/errors.js';
import { createServer } from '../shared/server.js';
import { bankRoutes } from './routes.js';
import { ChargeService } from './service.js';
import { BankStore } from './store.js';
import type { BankOptions } from './types.js';

export function createBank(options: BankOptions = {}) {
  const config = { ...bankConfig({}), ...options };
  const logger = options.logger ?? console.log;
  const store = new BankStore();
  const shutdown = new AbortController();
  const service = new ChargeService(store, config, shutdown.signal, options.random);
  const app = express();
  app.disable('x-powered-by');
  // Dùng cùng cơ chế khớp route của Express, kể cả /charges/ và /CHARGES.
  // Đếm trước JSON parser để request có body lỗi cũng được ghi nhận.
  app.post('/charges', (_req, _res, next) => {
    store.recordRequest();
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use(bankRoutes(service, store));
  jsonErrors(app);

  const server = createServer(app, {
    onConnection(socket) {
      const count = store.recordConnection();
      logger(`[bank] TCP mới #${count} ${socket.remoteAddress ?? '?'}:${socket.remotePort ?? '?'}`);
    },
  });
  // Không giữ timer trễ sống sau khi test/server đã đóng hết kết nối.
  server.on('close', () => shutdown.abort());
  return {
    app,
    server,
    get stats() {
      return store.stats;
    },
  };
}
