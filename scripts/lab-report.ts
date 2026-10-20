import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createBank } from '../src/bank/app.js';
import type { BankOptions } from '../src/bank/types.js';
import type { BankStats } from '../src/contracts/bank.js';
import type { FeeOptions, FeesResponse, PaymentStatus } from '../src/fee/types.js';
import {
  fixture,
  listen,
  closeServer,
  unusedPort,
  runBatch,
  summarize,
  seededRandom,
  sleep,
} from './lib/harness.js';
import type { Fixture, FixtureOptions } from './lib/harness.js';
import type { JsonResult } from './lib/http-client.js';

// Đối chứng cùng nghiệp vụ; tắt retry/pooling và tăng timeout lên 15 giây.
const baseline: FeeOptions = {
  timeoutMs: 15_000,
  attemptTimeoutMs: 15_000,
  maxAttempts: 1,
  keepAlive: false,
};

async function using<T>(options: FixtureOptions, work: (f: Fixture) => Promise<T>): Promise<T> {
  const f = await fixture(options);
  try {
    return await work(f);
  } finally {
    await f.close();
  }
}

function statusOf(result: JsonResult): PaymentStatus {
  const status = result.body.status;
  if (status === 'PAID' || status === 'PENDING' || status === 'FAILED') {
    return status;
  }
  throw new Error('Thanh toán trả status ngoài hợp đồng.');
}

const rounded = (n: number): number => Math.round(n * 100) / 100;

async function measureFault(fee: FeeOptions, bank: BankOptions) {
  return using({ fee, bank: { ...bank, random: seededRandom() } }, async (f) => {
    const start = performance.now();
    const results = await runBatch(60, 1, () => f.pay());
    const read = await f.request<FeesResponse>('/students/1/fees');
    return {
      ...summarize(results),
      elapsedMs: rounded(performance.now() - start),
      requests: f.bank.stats.requests,
      charges: f.bank.stats.charges,
      duplicates: f.bank.stats.duplicates,
      outstanding: read.body.outstanding,
      reserved: read.body.reserved,
    };
  });
}

async function measureMode(mode: 'before' | 'after', fee: FeeOptions) {
  console.log(`[${mode}] TH1: ngân hàng tắt rồi hoạt động lại`);
  const port = await unusedPort();
  const outage = await using({ fee, bankUrl: `http://127.0.0.1:${port}` }, async (f) => {
    const payment = await f.pay();
    const read = await f.request('/students/1/fees');
    const bank = createBank({ logger: () => {} });
    await listen(bank.server, port);
    try {
      const recovered = await f.pay();
      return {
        code: payment.code,
        status: statusOf(payment),
        ms: rounded(payment.ms),
        getCode: read.code,
        getMs: rounded(read.ms),
        recoveredCode: recovered.code,
      };
    } finally {
      await closeServer(bank.server);
    }
  });

  console.log(`[${mode}] TH2: DELAY_MS=5000, một request rồi 20 request đồng thời`);
  const slow = await using({ fee, bank: { delayMs: 5000 } }, async (f) => {
    const single = await f.pay();
    const start = performance.now();
    const batch = runBatch(20, 20, () => f.pay());
    await sleep(100);
    const read = await f.request('/students/1/fees');
    const results = await batch;
    return {
      singleCode: single.code,
      singleStatus: statusOf(single),
      singleMs: rounded(single.ms),
      ...summarize(results),
      batchMs: rounded(performance.now() - start),
      getCode: read.code,
      getMs: rounded(read.ms),
    };
  });

  console.log(`[${mode}] TH3: 200 thanh toán, 10 đồng thời${mode === 'after' ? ', idle 6s' : ''}`);
  const keepAlive = await using({ fee }, async (f) => {
    const before = (await f.bankRequest<BankStats>('/stats')).body;
    const start = performance.now();
    const results = await runBatch(200, 10, () => f.pay());
    const elapsedMs = rounded(performance.now() - start);
    const after = (await f.bankRequest<BankStats>('/stats')).body;
    let idlePaid: number | null = null;
    if (mode === 'after') {
      await sleep(6000);
      idlePaid = summarize(await runBatch(5, 5, () => f.pay())).paid;
    }
    return {
      ...summarize(results),
      elapsedMs,
      connections: after.connections,
      newConnections: after.connections - before.connections,
      charges: after.charges - before.charges,
      duplicates: after.duplicates,
      idlePaid,
    };
  });

  console.log(`[${mode}] TH4a: DROP_RATE=0.3, 60 thanh toán lần lượt`);
  const drop = await measureFault(fee, { dropRate: 0.3 });
  console.log(`[${mode}] TH4b: FAIL_RATE=0.3, 60 thanh toán lần lượt`);
  const fail = await measureFault(fee, { failRate: 0.3 });
  const declined = await using({ fee }, async (f) => {
    const r = await f.pay(25_000_000);
    return {
      code: r.code,
      status: statusOf(r),
      requests: f.bank.stats.requests,
      charges: f.bank.stats.charges,
    };
  });
  return { outage, slow, keepAlive, drop, fail, declined };
}

const before = await measureMode('before', baseline);
const after = await measureMode('after', {});
const report = {
  generatedAt: new Date().toISOString(),
  generatedLocal: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' }),
  node: process.version,
  implementation: 'TypeScript strict / pnpm',
  baseline: 'Cùng xử lý HTTP/nghiệp vụ; timeout 15s, một lần gọi, không keep-alive.',
  randomness: 'LCG seed=7 cho từng lần chạy lỗi; không sửa tỉ lệ lỗi 0.3.',
  results: { before, after },
};

const { before: b, after: a } = report.results;
const checks = {
  outage:
    a.outage.code === 503 &&
    a.outage.status === 'FAILED' &&
    a.outage.ms < 1500 &&
    a.outage.getCode === 200 &&
    a.outage.getMs < 300 &&
    a.outage.recoveredCode === 201,
  slow:
    a.slow.singleCode === 504 &&
    a.slow.singleStatus === 'PENDING' &&
    a.slow.singleMs <= 4500 &&
    a.slow.pending === 20 &&
    a.slow.maxMs <= 4500 &&
    a.slow.getCode === 200 &&
    a.slow.getMs < 300,
  keepAlive:
    a.keepAlive.paid === 200 &&
    a.keepAlive.charges === 200 &&
    a.keepAlive.duplicates === 0 &&
    a.keepAlive.connections <= 20 &&
    a.keepAlive.newConnections <= 20 &&
    a.keepAlive.idlePaid === 5,
  drop:
    a.drop.paid >= 54 &&
    a.drop.charges >= a.drop.paid &&
    a.drop.charges <= 60 &&
    (a.drop.codes['201'] || 0) + (a.drop.codes['504'] || 0) === 60 &&
    a.drop.pending === 60 - a.drop.paid &&
    a.drop.duplicates === 0 &&
    a.drop.maxMs <= 4500 &&
    a.drop.outstanding === 50_000_000 - a.drop.paid * 1000,
  fail:
    a.fail.paid >= 54 &&
    a.fail.charges === a.fail.paid &&
    a.fail.duplicates === 0 &&
    a.fail.maxMs <= 4500 &&
    a.fail.outstanding === 50_000_000 - a.fail.paid * 1000,
  declined:
    a.declined.code === 402 &&
    a.declined.status === 'FAILED' &&
    a.declined.requests === 1 &&
    a.declined.charges === 0,
};
const completedReport = { ...report, checks };
const markdown = `# Kết quả đo Lab 3

Thời điểm (UTC+7): ${report.generatedLocal}. Node: ${report.node}.

Đối chứng: ${report.baseline} Đây là cấu hình đối chứng được dựng để so sánh, không phải số đo từ mã nguồn cũ. TH1 và xử lý lỗi 4xx dùng chung nên có thể đã đạt ngay từ đối chứng.

${report.randomness} Kết quả thực tế dùng Math.random có thể thay đổi giữa các lần chạy.

| Tình huống | Đối chứng | Bản hoàn thiện | Đạt |
| --- | --- | --- | --- |
| 1. Ngân hàng tắt | HTTP ${b.outage.code}, ${b.outage.ms} ms | HTTP ${a.outage.code}, ${a.outage.ms} ms; phục hồi HTTP ${a.outage.recoveredCode} | ${checks.outage} |
| 2. Ngân hàng trễ 5s | HTTP ${b.slow.singleCode}, ${b.slow.singleMs} ms | HTTP ${a.slow.singleCode}/${a.slow.singleStatus}, ${a.slow.singleMs} ms | ${checks.slow} |
| 2. GET khi 20 lệnh chờ | ${b.slow.getMs} ms | ${a.slow.getMs} ms; ${a.slow.pending}/20 PENDING; max ${a.slow.maxMs} ms | ${checks.slow} |
| 3. 200 lệnh / 10 đồng thời | ${b.keepAlive.paid}/200 PAID; ${b.keepAlive.newConnections} TCP mới (${b.keepAlive.connections} tổng); ${b.keepAlive.elapsedMs} ms | ${a.keepAlive.paid}/200 PAID; ${a.keepAlive.newConnections} TCP mới (${a.keepAlive.connections} tổng); ${a.keepAlive.elapsedMs} ms | ${checks.keepAlive} |
| 3. Sau idle 6s | Chỉ đo bản hoàn thiện | ${a.keepAlive.idlePaid}/5 PAID | ${checks.keepAlive} |
| 4a. DROP_RATE=0.3 | ${b.drop.paid}/60 PAID; ${b.drop.charges} charges; ${b.drop.duplicates} duplicates | ${a.drop.paid}/60 PAID; ${a.drop.charges} charges; ${a.drop.duplicates} duplicates | ${checks.drop} |
| 4b. FAIL_RATE=0.3 | ${b.fail.paid}/60 PAID; ${b.fail.charges} charges; ${b.fail.duplicates} duplicates | ${a.fail.paid}/60 PAID; ${a.fail.charges} charges; ${a.fail.duplicates} duplicates | ${checks.fail} |
| 4c. Từ chối 25 triệu | HTTP ${b.declined.code}; ${b.declined.requests} request | HTTP ${a.declined.code}; ${a.declined.requests} request | ${checks.declined} |

TCP mới là chênh lệch connections ở /stats trước/sau batch, dùng lại một kết nối riêng để đọc stats. TCP tổng lấy trực tiếp từ /stats sau batch, bao gồm cả kết nối đọc stats; tiêu chí <= 20 được kiểm tra trên cả hai số. Requests đếm POST /charges; charges đếm lần trừ tiền thật; replay idempotency không tăng charges hoặc duplicates.

Dữ liệu JSON chi tiết: [lab-results.json](lab-results.json). Chạy lại bằng pnpm lab; runner dùng cổng ngẫu nhiên và dữ liệu riêng, không đụng các service bạn đang chạy ở 4001/4002.
`;
await mkdir('docs', { recursive: true });
await writeFile('docs/lab-results.json', `${JSON.stringify(completedReport, null, 2)}\n`);
await writeFile('docs/lab-results.md', markdown);
console.table(checks);
console.log('Đã ghi docs/lab-results.md và docs/lab-results.json.');
assert.ok(Object.values(checks).every(Boolean), 'Có tiêu chí chưa đạt; xem báo cáo.');
