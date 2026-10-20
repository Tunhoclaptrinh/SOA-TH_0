import { AppError } from '../shared/errors.js';
import type { Logger } from '../shared/types.js';
import type { FeeStore } from './store.js';
import type {
  FeesResponse,
  Payment,
  PaymentGateway,
  PaymentReply,
  PaymentResponse,
} from './types.js';

function paymentBody(payment: Payment): PaymentResponse {
  const identity = { paymentId: payment.id, studentId: payment.studentId, amount: payment.amount };
  const outcome = payment.outcome;
  if (outcome.status === 'PAID') {
    return {
      ...identity,
      status: outcome.status,
      attempts: outcome.attempts,
      chargeId: outcome.chargeId,
    };
  }
  return { ...identity, status: outcome.status, attempts: outcome.attempts, error: outcome.error };
}

function reply(payment: Payment): PaymentReply {
  return { httpStatus: payment.outcome.httpStatus, body: paymentBody(payment) };
}

export class PaymentService {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly store: FeeStore,
    private readonly bank: PaymentGateway,
    private readonly logger: Logger,
  ) {}

  fees(studentId: string): FeesResponse {
    return this.store.fees(studentId);
  }
  payment(paymentId: string): PaymentResponse {
    return paymentBody(this.store.payment(paymentId));
  }

  async create(studentId: string, amount: unknown): Promise<PaymentReply> {
    const payment = this.store.create(studentId, amount);
    await this.execute(payment);
    return reply(payment);
  }

  async retry(paymentId: string): Promise<PaymentReply> {
    const payment = this.store.payment(paymentId);
    if (payment.outcome.status === 'FAILED') {
      throw new AppError(409, 'Lệnh đã thất bại; hãy tạo lệnh mới.', payment.id);
    }
    if (payment.outcome.status === 'PENDING') {
      await this.execute(payment);
    }
    return reply(payment);
  }

  private async execute(payment: Payment): Promise<void> {
    const existing = this.inFlight.get(payment.id);
    if (existing) {
      return existing;
    }

    const operation = this.charge(payment);
    this.inFlight.set(payment.id, operation);
    try {
      await operation;
    } finally {
      this.inFlight.delete(payment.id);
    }
  }

  private async charge(payment: Payment): Promise<void> {
    const outcome = await this.bank.charge(
      { reference: payment.id, amount: payment.amount },
      payment.key,
      { previouslyUncertain: payment.everUncertain },
    );
    this.store.settle(payment, outcome);
    this.logger(
      `[fee] ${payment.id} ${outcome.status} amount=${payment.amount} attempts=${outcome.attempts}`,
    );
  }
}
