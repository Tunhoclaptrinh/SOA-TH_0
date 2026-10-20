import type { BankConfig, FeeConfig } from './config.types.js';
import type { Environment } from './types.js';

interface NumberOptions {
  min?: number;
  max?: number;
  integer?: boolean;
}

export function numberFromEnv(
  env: Environment,
  name: string,
  fallback: number,
  { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false }: NumberOptions = {},
): number {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (
    raw?.trim() === '' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new Error(`${name} cần ${integer ? 'số nguyên' : 'số'} trong [${min}, ${max}].`);
  }
  return value;
}

function booleanFromEnv(env: Environment, name: string, fallback: boolean): boolean {
  const value = env[name];
  if (value === undefined) {
    return fallback;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`${name} chỉ nhận true hoặc false.`);
}

export function validateBankUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('BANK_URL phải là URL HTTP hoặc HTTPS hợp lệ.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'BANK_URL phải dùng HTTP/HTTPS, không chứa thông tin đăng nhập, query hoặc fragment.',
    );
  }
  return url;
}

export function bankConfig(env: Environment = process.env): BankConfig {
  return {
    port: numberFromEnv(env, 'BANK_PORT', 4002, { min: 1, max: 65535, integer: true }),
    delayMs: numberFromEnv(env, 'DELAY_MS', 0, { max: 2_147_483_647, integer: true }),
    failRate: numberFromEnv(env, 'FAIL_RATE', 0, { max: 1 }),
    dropRate: numberFromEnv(env, 'DROP_RATE', 0, { max: 1 }),
  };
}

export function feeConfig(env: Environment = process.env): FeeConfig {
  const bankUrl = env.BANK_URL ?? 'http://localhost:4002';
  validateBankUrl(bankUrl);
  return {
    port: numberFromEnv(env, 'FEE_PORT', 4001, { min: 1, max: 65535, integer: true }),
    bankUrl,
    timeoutMs: numberFromEnv(env, 'PAYMENT_TIMEOUT_MS', 4000, {
      min: 1,
      max: 2_147_483_647,
      integer: true,
    }),
    attemptTimeoutMs: numberFromEnv(env, 'ATTEMPT_TIMEOUT_MS', 1200, {
      min: 1,
      max: 2_147_483_647,
      integer: true,
    }),
    connectTimeoutMs: numberFromEnv(env, 'CONNECT_TIMEOUT_MS', 700, {
      min: 1,
      max: 2_147_483_647,
      integer: true,
    }),
    maxAttempts: numberFromEnv(env, 'MAX_ATTEMPTS', 4, { min: 1, max: 10, integer: true }),
    keepAlive: booleanFromEnv(env, 'KEEP_ALIVE', true),
  };
}
