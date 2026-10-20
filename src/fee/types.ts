import type { ChargeRequest } from '../contracts/bank.js';
import type { BankClientConfig, FeeConfig } from '../shared/config.types.js';
import type { Logger } from '../shared/types.js';

export interface PaidOutcome {
  readonly status: 'PAID';
  readonly httpStatus: 201;
  readonly chargeId: string;
  readonly attempts: number;
}

export interface PendingOutcome {
  readonly status: 'PENDING';
  readonly httpStatus: 504;
  readonly error: string;
  readonly attempts: number;
}

export interface FailedOutcome {
  readonly status: 'FAILED';
  readonly httpStatus: number;
  readonly error: string;
  readonly attempts: number;
}

export type PaymentOutcome = PaidOutcome | PendingOutcome | FailedOutcome;
export type PaymentStatus = PaymentOutcome['status'];

export interface ChargeContext {
  previouslyUncertain?: boolean;
}

/** Port nghiệp vụ; Fee không đọc trực tiếp bộ nhớ của ngân hàng. */
export interface PaymentGateway {
  charge(request: ChargeRequest, key: string, context?: ChargeContext): Promise<PaymentOutcome>;
  close(): void;
}

export interface FeeOptions extends Partial<FeeConfig> {
  bankClient?: PaymentGateway;
  logger?: Logger;
}

export type BankClientOptions = Partial<BankClientConfig>;

export interface StudentAccount {
  outstanding: number;
  reserved: number;
}

export interface FeesResponse extends StudentAccount {
  studentId: string;
  available: number;
}

export interface Payment {
  readonly id: string;
  readonly key: string;
  readonly studentId: string;
  readonly amount: number;
  outcome: PaymentOutcome;
  everUncertain: boolean;
}

export interface PaymentIdentity {
  paymentId: string;
  studentId: string;
  amount: number;
}

type OutcomeBody<T> = T extends PaymentOutcome ? Omit<T, 'httpStatus'> : never;
export type PaymentResponse = PaymentIdentity & OutcomeBody<PaymentOutcome>;

export interface PaymentReply {
  httpStatus: number;
  body: PaymentResponse;
}
