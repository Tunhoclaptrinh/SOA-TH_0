import { setTimeout as sleep } from 'node:timers/promises';
import { isRecord } from '../../src/shared/validation.js';
import type { JsonResult } from './http-client.js';

export { sleep };

export async function runBatch<T>(
  count: number,
  concurrency: number,
  task: (index: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, count) }, async () => {
      while (next < count) {
        const index = next++;
        results[index] = await task(index);
      }
    }),
  );
  return results;
}

export function summarize<T>(results: readonly JsonResult<T>[]) {
  const codes: Record<string, number> = {};
  for (const result of results) {
    codes[result.code] = (codes[result.code] ?? 0) + 1;
  }
  return {
    total: results.length,
    paid: results.filter((r) => r.code === 201 && isRecord(r.body) && r.body.status === 'PAID')
      .length,
    pending: results.filter((r) => isRecord(r.body) && r.body.status === 'PENDING').length,
    codes,
    maxMs: Math.round(Math.max(0, ...results.map((r) => r.ms))),
  };
}
