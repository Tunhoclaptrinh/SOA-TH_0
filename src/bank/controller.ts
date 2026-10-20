import type { RequestHandler } from 'express';
import type { Charge } from '../contracts/bank.js';
import type { ErrorBody } from '../shared/types.js';
import type { ChargeService } from './service.js';
import { parseCharge } from './validation.js';

export function createChargeController(
  service: ChargeService,
): RequestHandler<Record<string, never>, Charge | ErrorBody, unknown> {
  return async (req, res) => {
    const input = parseCharge(req.body, req.get('Idempotency-Key'));
    try {
      const result = await service.charge(input);
      if (result.kind === 'created' && result.dropResponse) {
        req.socket.destroy();
        return;
      }
      if (result.kind === 'replayed') {
        res.set('Idempotency-Replayed', 'true');
      }
      res.status(201).json(result.charge);
    } catch (error) {
      // Shutdown hủy các timer đang chờ; socket cũng được đóng bởi server.
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      throw error;
    }
  };
}
