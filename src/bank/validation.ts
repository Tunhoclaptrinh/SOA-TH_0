import { AppError } from '../shared/errors.js';
import { isPositiveMoney, isRecord } from '../shared/validation.js';
import type { ChargeInput } from './types.js';

export function parseCharge(body: unknown, key: string | undefined): ChargeInput {
  if (
    !isRecord(body) ||
    typeof body.reference !== 'string' ||
    !body.reference.trim() ||
    !isPositiveMoney(body.amount) ||
    !key?.trim() ||
    key.length > 200
  ) {
    throw new AppError(400, 'Cần reference, Idempotency-Key và amount là số nguyên dương (VND).');
  }
  return { reference: body.reference, amount: body.amount, key };
}
