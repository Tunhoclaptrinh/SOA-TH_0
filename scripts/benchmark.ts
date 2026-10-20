import 'dotenv/config';
import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import type { BankStats } from '../src/contracts/bank.js';
import { numberFromEnv, validateBankUrl } from '../src/shared/config.js';
import { jsonRequest } from './lib/http-client.js';
import type { JsonRequestOptions } from './lib/http-client.js';
import { runBatch, summarize, sleep } from './lib/batch.js';

const positional = process.argv.slice(2).filter((arg) => arg !== '--idle');
const count = Number(positional[0] ?? 200);
const concurrency = Number(positional[1] ?? 10);
const amount = numberFromEnv(process.env, 'AMOUNT', 1000, { min: 1, integer: true });
if (positional.length > 2 || ![count, concurrency].every((n) => Number.isSafeInteger(n) && n > 0)) {
  throw new Error(
    'Dùng: pnpm bench [số request nguyên dương] [độ đồng thời nguyên dương] [--idle]',
  );
}
const feeUrl = validateBankUrl(process.env.FEE_URL ?? 'http://localhost:4001').href.replace(
  /\/$/,
  '',
);
const bankUrl = validateBankUrl(process.env.BANK_URL ?? 'http://localhost:4002').href.replace(
  /\/$/,
  '',
);
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: concurrency });
const call = <T = Record<string, unknown>>(url: string, options: JsonRequestOptions = {}) =>
  jsonRequest<T>(url, {
    agent: new URL(url).protocol === 'https:' ? httpsAgent : httpAgent,
    ...options,
  });

try {
  const statsBefore = await call<BankStats>(`${bankUrl}/stats`);
  if (statsBefore.code !== 200) {
    throw new Error('Không đọc được thống kê ngân hàng.');
  }
  const before = statsBefore.body;
  const start = performance.now();
  const results = await runBatch(count, concurrency, () =>
    call(`${feeUrl}/students/1/payments`, {
      method: 'POST',
      body: { amount },
    }),
  );
  const elapsedMs = Math.round(performance.now() - start);
  const after = (await call<BankStats>(`${bankUrl}/stats`)).body;
  console.log(
    JSON.stringify(
      {
        ...summarize(results),
        concurrency,
        amount,
        elapsedMs,
        newBankConnections: after.connections - before.connections,
        newCharges: after.charges - before.charges,
        duplicates: after.duplicates,
        before,
        after,
      },
      null,
      2,
    ),
  );
  if (results.some((r) => r.code !== 201)) {
    process.exitCode = 1;
  }
  if (process.argv.includes('--idle')) {
    console.log('Đợi nhàn rỗi 6 giây...');
    await sleep(6000);
    const resumed = await runBatch(5, 5, () =>
      call(`${feeUrl}/students/1/payments`, {
        method: 'POST',
        body: { amount },
      }),
    );
    console.log('Sau idle:', summarize(resumed));
    if (resumed.some((r) => r.code !== 201)) {
      process.exitCode = 1;
    }
  }
} finally {
  httpAgent.destroy();
  httpsAgent.destroy();
}
