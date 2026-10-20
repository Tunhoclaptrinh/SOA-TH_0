export interface BankConfig {
  readonly port: number;
  readonly delayMs: number;
  readonly failRate: number;
  readonly dropRate: number;
}

export interface BankClientConfig {
  readonly bankUrl: string;
  readonly timeoutMs: number;
  readonly attemptTimeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly maxAttempts: number;
  readonly keepAlive: boolean;
}

export interface FeeConfig extends BankClientConfig {
  readonly port: number;
}
