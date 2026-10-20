import http from 'node:http';
import { createBank } from '../../src/bank/app.js';
import type { BankOptions } from '../../src/bank/types.js';
import { createFee } from '../../src/fee/app.js';
import type { FeeOptions } from '../../src/fee/types.js';
import { jsonRequest } from './http-client.js';
import type { JsonRequestOptions } from './http-client.js';

export { jsonRequest } from './http-client.js';
export { sleep, runBatch, summarize } from './batch.js';

export interface FixtureOptions {
  bank?: BankOptions;
  fee?: FeeOptions;
  bankUrl?: string;
  bankPort?: number;
}

function serverPort(server: http.Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server chưa mở cổng TCP.');
  }
  return address.port;
}

export async function listen(server: http.Server, port = 0): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error): void => {
      reject(error);
    };
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', fail);
      resolve();
    });
  });
  return `http://127.0.0.1:${serverPort(server)}`;
}

export async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

export async function unusedPort(): Promise<number> {
  const server = http.createServer();
  await listen(server);
  const port = serverPort(server);
  await closeServer(server);
  return port;
}

export function seededRandom(seed = 7): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export async function fixture({
  bank: bankOptions = {},
  fee: feeOptions = {},
  bankUrl,
  bankPort = 0,
}: FixtureOptions = {}) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 64 });
  let bank: ReturnType<typeof createBank> | undefined;
  let fee: ReturnType<typeof createFee> | undefined;
  try {
    if (!bankUrl) {
      bank = createBank({ logger: () => {}, ...bankOptions });
      bankUrl = await listen(bank.server, bankPort);
    }
    const target = bankUrl;
    const runningFee = createFee({ logger: () => {}, bankUrl: target, ...feeOptions });
    fee = runningFee;
    const feeUrl = await listen(runningFee.server);
    return {
      get bank() {
        if (!bank) {
          throw new Error('Fixture này sử dụng ngân hàng bên ngoài.');
        }
        return bank;
      },
      fee: runningFee,
      bankUrl: target,
      feeUrl,
      request: <T = Record<string, unknown>>(path: string, options: JsonRequestOptions = {}) =>
        jsonRequest<T>(`${feeUrl}${path}`, { agent, ...options }),
      bankRequest: <T = Record<string, unknown>>(path: string, options: JsonRequestOptions = {}) =>
        jsonRequest<T>(`${target}${path}`, { agent, ...options }),
      pay: (amount: unknown = 1000, student = 1) =>
        jsonRequest(`${feeUrl}/students/${student}/payments`, {
          method: 'POST',
          body: { amount },
          agent,
        }),
      async close(): Promise<void> {
        agent.destroy();
        runningFee.close();
        await closeServer(runningFee.server);
        if (bank) {
          await closeServer(bank.server);
        }
      },
    };
  } catch (error: unknown) {
    agent.destroy();
    fee?.close();
    if (fee) {
      await closeServer(fee.server);
    }
    if (bank) {
      await closeServer(bank.server);
    }
    throw error;
  }
}

export type Fixture = Awaited<ReturnType<typeof fixture>>;
