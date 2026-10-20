import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Charge, ChargeRequest } from '../contracts/bank.js';
import { feeConfig } from '../shared/config.js';
import type { BankClientConfig } from '../shared/config.types.js';
import { errorMessage, isRecord } from '../shared/validation.js';
import { BankTransport, BankTransportError } from './bank-transport.js';
import type {
  BankClientOptions,
  ChargeContext,
  FailedOutcome,
  PaymentGateway,
  PaymentOutcome,
  PendingOutcome,
} from './types.js';

function isConfirmation(body: unknown, request: ChargeRequest): body is Charge {
  return (
    isRecord(body) &&
    typeof body.chargeId === 'string' &&
    body.chargeId.trim().length > 0 &&
    body.reference === request.reference &&
    body.amount === request.amount
  );
}

function bankError(body: unknown, fallback: string): string {
  return isRecord(body) && typeof body.error === 'string' && body.error.trim()
    ? body.error
    : fallback;
}

/** Chính sách retry và phân loại kết quả; mọi lần gọi giữ nguyên key và payload. */
export class BankClient implements PaymentGateway {
  private readonly config: BankClientConfig;
  private readonly transport: BankTransport;

  constructor(options: BankClientOptions = {}) {
    this.config = { ...feeConfig({}), ...options };
    this.transport = new BankTransport(this.config);
  }

  close(): void {
    this.transport.close();
  }

  async charge(
    payload: ChargeRequest,
    key: string,
    { previouslyUncertain = false }: ChargeContext = {},
  ): Promise<PaymentOutcome> {
    const deadline = performance.now() + this.config.timeoutMs;
    let uncertain = previouslyUncertain;
    let message = 'Ngân hàng tạm thời không khả dụng.';
    let attempts = 0;
    const pending = (): PendingOutcome => ({
      httpStatus: 504,
      status: 'PENDING',
      error: message,
      attempts,
    });
    const failed = (): FailedOutcome => ({
      httpStatus: 503,
      status: 'FAILED',
      error: message,
      attempts,
    });

    for (let index = 0; index < this.config.maxAttempts; index += 1) {
      const remaining = deadline - performance.now();
      if (remaining < 1) {
        break;
      }
      attempts += 1;
      try {
        const result = await this.transport.request(payload, key, remaining);
        if (result.code === 201 && isConfirmation(result.body, payload)) {
          return { httpStatus: 201, status: 'PAID', chargeId: result.body.chargeId, attempts };
        }
        if (result.code >= 400 && result.code < 500) {
          message = bankError(result.body, 'Ngân hàng từ chối giao dịch.');
          // Không thử lại 4xx; một lần mơ hồ trước đó không được biến thành FAILED.
          return uncertain
            ? pending()
            : { httpStatus: result.code, status: 'FAILED', error: message, attempts };
        }
        if (result.code >= 500 && result.code <= 599) {
          // Hợp đồng lab: 5xx chỉ xảy ra TRƯỚC khi trừ tiền.
          message = bankError(result.body, 'Ngân hàng tạm lỗi.');
        } else {
          uncertain = true;
          message = `Ngân hàng chưa trả xác nhận giao dịch hợp lệ (HTTP ${result.code}).`;
        }
      } catch (error: unknown) {
        const definitelyNotSent = error instanceof BankTransportError && !error.uncertain;
        uncertain ||= !definitelyNotSent;
        message = errorMessage(error);
        if (definitelyNotSent) {
          return uncertain ? pending() : failed();
        }
      }
      if (index + 1 < this.config.maxAttempts) {
        const waitMs = Math.min(100 * 2 ** index, Math.max(0, deadline - performance.now()));
        if (waitMs > 0) {
          await sleep(waitMs);
        }
      }
    }
    return uncertain ? pending() : failed();
  }
}
