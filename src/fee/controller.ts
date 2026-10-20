import type { RequestHandler } from 'express';
import type { IdParams } from '../shared/types.js';
import { isRecord } from '../shared/validation.js';
import type { PaymentService } from './service.js';
import type { FeesResponse, PaymentResponse } from './types.js';

export function paymentController(service: PaymentService) {
  const fees: RequestHandler<IdParams, FeesResponse, unknown> = (req, res) => {
    res.json(service.fees(req.params.id));
  };
  const payment: RequestHandler<IdParams, PaymentResponse, unknown> = (req, res) => {
    res.json(service.payment(req.params.id));
  };
  const create: RequestHandler<IdParams, PaymentResponse, unknown> = async (req, res) => {
    const amount = isRecord(req.body) ? req.body.amount : undefined;
    const result = await service.create(req.params.id, amount);
    res.status(result.httpStatus).json(result.body);
  };
  const retry: RequestHandler<IdParams, PaymentResponse, unknown> = async (req, res) => {
    const result = await service.retry(req.params.id);
    res.status(result.httpStatus).json(result.body);
  };
  return { fees, payment, create, retry };
}
