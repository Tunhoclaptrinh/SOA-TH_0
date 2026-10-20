export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPositiveMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Lỗi không xác định.';
}
