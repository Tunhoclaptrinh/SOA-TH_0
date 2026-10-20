import type { Charge } from '../contracts/bank.js';
import type { BankConfig } from '../shared/config.types.js';
import type { Logger } from '../shared/types.js';

export interface BankOptions extends Partial<BankConfig> {
  random?: () => number;
  logger?: Logger;
}

export interface ChargeInput {
  readonly reference: string;
  readonly amount: number;
  readonly key: string;
}

export type ChargeDecision =
  | { kind: 'replayed'; charge: Charge }
  | { kind: 'created'; charge: Charge; dropResponse: boolean };
