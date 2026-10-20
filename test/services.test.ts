import test from 'node:test';
import type { TestContext } from 'node:test';
import type { FixtureOptions } from '../scripts/lib/harness.js';
import type { BankStats, ChargeRequest } from '../src/contracts/bank.js';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createBank } from '../src/bank/app.js';
import { BankClient } from '../src/fee/bank-client.js';
import { feeConfig, bankConfig } from '../src/shared/config.js';
import {
  fixture,
  listen,
  closeServer,
  unusedPort,
  seededRandom,
  sleep,
  runBatch,
} from '../scripts/lib/harness.js';

async function setup(t: TestContext, options: FixtureOptions = {}) {
  const f = await fixture(options);
  t.after(() => f.close());
  return f;
}

void test('đọc đúng biến môi trường, kiểm tra cấu hình không hợp lệ', () => {
  assert.equal(feeConfig({ BANK_URL: 'http://localhost:4999' }).bankUrl, 'http://localhost:4999');
  assert.equal(feeConfig({}).timeoutMs, 4000);
  assert.throws(() => bankConfig({ FAIL_RATE: '2' }));
  assert.throws(() => feeConfig({ MAX_ATTEMPTS: '0' }));
  assert.throws(() => feeConfig({ KEEP_ALIVE: 'yes' }));
  assert.throws(() => feeConfig({ PAYMENT_TIMEOUT_MS: '' }));
  assert.throws(() => feeConfig({ BANK_URL: 'not-a-url' }));
  assert.throws(() => bankConfig({ BANK_PORT: '0' }));
  assert.throws(() => bankConfig({ DELAY_MS: '-1' }));
  assert.throws(() => new BankClient({ bankUrl: 'file:///tmp/bank' }));
});

void test('đúng dữ liệu sinh viên, kiểm tra amount và lỗi JSON', async (t) => {
  const f = await setup(t);
  for (const [id, outstanding] of [
    [1, 50_000_000],
    [2, 0],
    [3, 3_200_000],
  ]) {
    const r = await f.request(`/students/${id}/fees`);
    assert.equal(r.code, 200);
    assert.equal(r.body.outstanding, outstanding);
  }
  for (const amount of [0, -1, 1.5, '1000', null, 50_000_001]) {
    const r = await f.pay(amount);
    assert.equal(r.code, 400);
    assert.equal(r.body.status, 'FAILED');
    assert.equal(r.body.paymentId, null);
    assert.ok(r.body.error);
  }
  assert.equal((await f.pay(1, 2)).code, 400);
  assert.equal((await f.pay(1, 999)).code, 404);
  assert.equal(f.bank.stats.requests, 0);
  const badJson = await f.request('/students/1/payments', {
    method: 'POST',
    rawBody: '{',
  });
  assert.equal(badJson.code, 400);
  assert.equal(badJson.body.status, 'FAILED');
});

void test('ngân hàng idempotent kể cả các request đồng thời; đổi payload cùng khóa trả 409', async (t) => {
  const f = await setup(t, { bank: { delayMs: 30 } });
  const charge = (body: ChargeRequest, key = 'same-key') =>
    f.bankRequest('/charges', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body,
    });
  const results = await runBatch(10, 10, () => charge({ reference: 'X1', amount: 1000 }));
  assert.ok(results.every((r) => r.code === 201 && r.body.chargeId === 'C1'));
  assert.equal((await charge({ reference: 'X1', amount: 2000 })).code, 409);
  assert.equal((await charge({ reference: 'bad', amount: -1 }, 'bad')).code, 400);
  assert.equal((await charge({ reference: 'limit', amount: 25_000_000 }, 'limit')).code, 402);
  assert.equal(
    (await f.bankRequest('/charges', { method: 'POST', body: { reference: 'no-key', amount: 1 } }))
      .code,
    400,
  );
  assert.equal(f.bank.stats.charges, 1);
  assert.equal(f.bank.stats.duplicates, 0);
});

void test('thanh toán thành công giảm công nợ đúng một lần; retry PAID không gọi ngân hàng', async (t) => {
  const f = await setup(t);
  const r = await f.pay(100_000);
  assert.equal(r.code, 201);
  assert.equal(r.body.paymentId, 'P1');
  assert.equal(r.body.status, 'PAID');
  assert.equal((await f.request('/students/1/fees')).body.outstanding, 49_900_000);
  const replay = await f.request('/payments/P1/retry', { method: 'POST' });
  assert.equal(replay.code, 201);
  assert.equal(replay.body.chargeId, r.body.chargeId);
  assert.equal(f.bank.stats.requests, 1);
});

void test('TH1: ngân hàng tắt trả 503 nhanh, GET sống, ngân hàng lên lại không cần restart Fee', async (t) => {
  const port = await unusedPort();
  const f = await setup(t, { bankUrl: `http://127.0.0.1:${port}` });
  const r = await f.pay(100_000);
  assert.equal(r.code, 503);
  assert.equal(r.body.status, 'FAILED');
  assert.ok(r.body.error);
  assert.equal(r.body.paymentId, 'P1');
  assert.ok(r.ms < 1500, `mất ${r.ms}ms`);
  const fees = await f.request('/students/1/fees');
  assert.equal(fees.code, 200);
  assert.equal(fees.body.outstanding, 50_000_000);
  assert.equal(fees.body.reserved, 0);
  const bank = createBank({ logger: () => {} });
  await listen(bank.server, port);
  t.after(() => closeServer(bank.server));
  assert.equal((await f.pay(100_000)).code, 201);
});

void test('TH2: 20 thanh toán chậm trả 504/PENDING <=4,5s, GET <300ms', async (t) => {
  const f = await setup(t, { bank: { delayMs: 5000 } });
  const pending = runBatch(20, 20, () => f.pay());
  await sleep(100);
  const fees = await f.request('/students/1/fees');
  assert.equal(fees.code, 200);
  assert.ok(fees.ms < 300, `GET mất ${fees.ms}ms`);
  assert.equal(fees.body.outstanding, 50_000_000);
  assert.equal(fees.body.reserved, 20_000);
  const results = await pending;
  assert.ok(results.every((r) => r.code === 504 && r.body.status === 'PENDING'));
  assert.ok(
    results.every((r) => r.ms <= 4500),
    JSON.stringify(results.map((r) => r.ms)),
  );
  assert.equal((await f.request('/students/1/fees')).body.outstanding, 50_000_000);
});

void test('TH3: 200 thanh toán / 10 đồng thời dùng <=20 TCP, tiếp tục được sau idle 6s', async (t) => {
  const f = await setup(t);
  const before = (await f.bankRequest<BankStats>('/stats')).body;
  const results = await runBatch(200, 10, () => f.pay());
  const after = (await f.bankRequest<BankStats>('/stats')).body;
  assert.ok(results.every((r) => r.code === 201));
  assert.ok(after.connections - before.connections <= 20);
  assert.ok(after.connections <= 20, 'Tổng TCP, kể cả kết nối đọc stats, phải <= 20.');
  assert.equal(after.charges, 200);
  assert.equal(after.duplicates, 0);
  await sleep(6000);
  const resumed = await runBatch(5, 5, () => f.pay());
  assert.ok(resumed.every((r) => r.code === 201));
});

for (const [name, config] of [
  ['TH4a: DROP_RATE=0.3', { dropRate: 0.3 }],
  ['TH4b: FAIL_RATE=0.3', { failRate: 0.3 }],
] as const) {
  void test(`${name}, >=54/60 PAID, duplicates=0 và công nợ khớp PAID`, async (t) => {
    const f = await setup(t, { bank: { ...config, random: seededRandom() } });
    const results = await runBatch(60, 1, () => f.pay());
    const paid = results.filter((r) => r.code === 201 && r.body.status === 'PAID').length;
    assert.ok(paid >= 54, `${paid}/60 PAID`);
    assert.equal(f.bank.stats.duplicates, 0);
    assert.ok(f.bank.stats.charges >= paid);
    assert.equal((await f.request('/students/1/fees')).body.outstanding, 50_000_000 - paid * 1000);
    assert.ok(results.every((r) => r.ms <= 4500));
    for (const r of results.filter((r) => r.code !== 201)) {
      if ('dropRate' in config) {
        assert.equal(r.code, 504);
        assert.equal(r.body.status, 'PENDING');
      }
    }
  });
}

void test('TH4c: 25 triệu trả 402, chỉ gọi ngân hàng đúng một lần', async (t) => {
  const f = await setup(t);
  const r = await f.pay(25_000_000);
  assert.equal(r.code, 402);
  assert.equal(r.body.status, 'FAILED');
  assert.equal(r.body.attempts, 1);
  assert.ok(r.body.error);
  assert.equal(f.bank.stats.requests, 1);
  assert.equal(f.bank.stats.charges, 0);
  assert.equal((await f.request('/students/1/fees')).body.reserved, 0);
});

void test('500 liên tục hết retry trả 503/FAILED, không giảm công nợ', async (t) => {
  const f = await setup(t, { bank: { failRate: 1 } });
  const r = await f.pay();
  assert.equal(r.code, 503);
  assert.equal(r.body.status, 'FAILED');
  assert.equal(r.body.attempts, 4);
  assert.equal(f.bank.stats.charges, 0);
  assert.equal((await f.request('/students/1/fees')).body.reserved, 0);
});

void test('PENDING giữ chỗ, retry đồng thời cùng khóa chỉ cập nhật công nợ một lần', async (t) => {
  const f = await setup(t, { bank: { dropRate: 1 }, fee: { maxAttempts: 1 } });
  const first = await f.pay(100_000);
  assert.equal(first.code, 504);
  assert.equal(first.body.status, 'PENDING');
  let fees = (await f.request('/students/1/fees')).body;
  assert.equal(fees.outstanding, 50_000_000);
  assert.equal(fees.reserved, 100_000);
  const results = await runBatch(10, 10, () => f.request('/payments/P1/retry', { method: 'POST' }));
  assert.ok(results.every((r) => r.code === 201 && r.body.chargeId === 'C1'));
  fees = (await f.request('/students/1/fees')).body;
  assert.equal(fees.outstanding, 49_900_000);
  assert.equal(fees.reserved, 0);
  assert.equal(f.bank.stats.charges, 1);
  assert.equal(f.bank.stats.duplicates, 0);
});

void test('PENDING rồi ngân hàng tắt: vẫn PENDING, không giải phóng khoản chưa rõ kết quả', async (t) => {
  const f = await setup(t, { bank: { dropRate: 1 }, fee: { maxAttempts: 1 } });
  assert.equal((await f.pay(1000)).code, 504);
  await closeServer(f.bank.server);
  const retry = await f.request('/payments/P1/retry', { method: 'POST' });
  assert.equal(retry.code, 504);
  assert.equal(retry.body.status, 'PENDING');
  assert.equal((await f.request('/students/1/fees')).body.reserved, 1000);
});

void test('ngân hàng trừ tiền sau timeout; retry truy lại charge cũ và giảm công nợ đúng', async (t) => {
  const f = await setup(t, {
    bank: { delayMs: 120 },
    fee: { maxAttempts: 1, attemptTimeoutMs: 50 },
  });
  const first = await f.pay(1000);
  assert.equal(first.code, 504);
  assert.equal(first.body.status, 'PENDING');
  await sleep(150);
  assert.equal(f.bank.stats.charges, 1);
  assert.equal((await f.request('/students/1/fees')).body.outstanding, 50_000_000);
  const result = await f.request('/payments/P1/retry', { method: 'POST' });
  assert.equal(result.code, 201);
  assert.equal(result.body.chargeId, 'C1');
  assert.equal(f.bank.stats.charges, 1);
  assert.equal(f.bank.stats.duplicates, 0);
  assert.equal((await f.request('/students/1/fees')).body.outstanding, 49_999_000);
});

void test('mất kết nối trước khi có phản hồi: hết retry vẫn trả 504/PENDING', async (t) => {
  const server = http.createServer((req) => req.socket.destroy());
  const bankUrl = await listen(server);
  t.after(() => closeServer(server));
  const f = await setup(t, { bankUrl });
  const result = await f.pay(1000);
  assert.equal(result.code, 504);
  assert.equal(result.body.status, 'PENDING');
  assert.equal(result.body.attempts, 4);
  assert.equal((await f.request('/students/1/fees')).body.reserved, 1000);
});

void test('phản hồi bị cắt giữa body không được nhận là PAID', async (t) => {
  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(201, { 'Content-Type': 'application/json', 'Content-Length': 100 });
    res.write('{"chargeId":');
    setImmediate(() => res.destroy());
  });
  const bankUrl = await listen(server);
  t.after(() => closeServer(server));
  const f = await setup(t, { bankUrl });
  const result = await f.pay(1000);
  assert.equal(result.code, 504);
  assert.equal(result.body.status, 'PENDING');
  assert.equal((await f.request('/students/1/fees')).body.outstanding, 50_000_000);
});

void test('thanh toán đồng thời không vượt công nợ', async (t) => {
  const f = await setup(t, { bank: { delayMs: 100 } });
  const results = await runBatch(3, 3, () => f.pay(1_600_000, 3));
  assert.equal(results.filter((r) => r.code === 201).length, 2);
  assert.equal(results.filter((r) => r.code === 400).length, 1);
  assert.equal(f.bank.stats.charges, 2);
  assert.equal((await f.request('/students/3/fees')).body.outstanding, 0);
});

void test('PENDING giữ toàn bộ công nợ khả dụng, không cho tạo lệnh khác vượt nợ', async (t) => {
  const f = await setup(t, { bank: { dropRate: 1 }, fee: { maxAttempts: 1 } });
  const first = await f.pay(3_200_000, 3);
  assert.equal(first.code, 504);
  assert.equal((await f.pay(1, 3)).code, 400);
  assert.equal(f.bank.stats.requests, 1);
  const fees = (await f.request('/students/3/fees')).body;
  assert.equal(fees.outstanding, 3_200_000);
  assert.equal(fees.reserved, 3_200_000);
  assert.equal(fees.available, 0);
  assert.equal((await f.request('/payments/P1/retry', { method: 'POST' })).code, 201);
  assert.equal((await f.request('/students/3/fees')).body.outstanding, 0);
});

void test('HTTP 201 có xác nhận sai reference không được giảm công nợ', async (t) => {
  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ chargeId: 'C1', reference: 'WRONG', amount: 1000 }));
  });
  const bankUrl = await listen(server);
  t.after(() => closeServer(server));
  const f = await setup(t, { bankUrl });
  const result = await f.pay(1000);
  assert.equal(result.code, 504);
  assert.equal(result.body.status, 'PENDING');
  assert.equal((await f.request('/students/1/fees')).body.outstanding, 50_000_000);
});

void test('thống kê duplicates phát hiện client dùng sai khóa cho cùng một reference', async (t) => {
  const f = await setup(t);
  for (const key of ['key-1', 'key-2']) {
    const result = await f.bankRequest('/charges', {
      method: 'POST',
      body: { reference: 'SAME-REFERENCE', amount: 1000 },
      headers: { 'Idempotency-Key': key },
    });
    assert.equal(result.code, 201);
  }
  assert.equal(f.bank.stats.charges, 2);
  assert.equal(f.bank.stats.duplicates, 1);
});

void test('stats phải đếm đúng mọi POST charges mà Express chấp nhận, kể cả JSON lỗi', async (t) => {
  const f = await setup(t);
  for (const [index, path] of ['/charges', '/charges/', '/CHARGES'].entries()) {
    const result = await f.bankRequest(path, {
      method: 'POST',
      headers: { 'Idempotency-Key': `stats-key-${index}` },
      body: { reference: `STATS-${index}`, amount: 1000 },
    });
    assert.equal(result.code, 201);
  }
  const malformed = await f.bankRequest('/CHARGES', { method: 'POST', rawBody: '{' });
  assert.equal(malformed.code, 400);
  assert.equal(f.bank.stats.requests, 4);
  assert.equal(f.bank.stats.charges, 3);
  assert.equal(f.bank.stats.duplicates, 0);
});
