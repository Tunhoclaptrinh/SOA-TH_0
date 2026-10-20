import http from 'node:http';
import https from 'node:https';
import { TLSSocket } from 'node:tls';
import type { ChargeRequest } from '../contracts/bank.js';
import { validateBankUrl } from '../shared/config.js';
import type { BankClientConfig } from '../shared/config.types.js';

export class BankTransportError extends Error {
  constructor(
    message: string,
    readonly uncertain: boolean,
  ) {
    super(message);
    this.name = 'BankTransportError';
  }
}

export interface BankHttpResponse {
  code: number;
  body: unknown;
}

/** Chỉ chịu trách nhiệm HTTP/TCP và deadline của từng lần gọi. */
export class BankTransport {
  private readonly url: URL;
  private readonly agent: http.Agent;

  constructor(private readonly config: BankClientConfig) {
    this.url = validateBankUrl(config.bankUrl);
    this.url.pathname = `${this.url.pathname.replace(/\/$/, '')}/charges`;
    const Agent = this.url.protocol === 'https:' ? https.Agent : http.Agent;
    this.agent = new Agent({
      keepAlive: config.keepAlive,
      maxSockets: 20,
      maxFreeSockets: 10,
      scheduling: 'lifo',
      timeout: 4000,
    });
  }

  close(): void {
    this.agent.destroy();
  }

  request(payload: ChargeRequest, key: string, budgetMs: number): Promise<BankHttpResponse> {
    return new Promise((resolve, reject) => {
      let connected = false;
      let settled = false;
      let response: http.IncomingMessage | undefined;

      const clearTimers = (): void => {
        clearTimeout(connectTimer);
        clearTimeout(deadlineTimer);
      };
      const fail = (error: BankTransportError): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimers();
        reject(error);
      };
      const succeed = (result: BankHttpResponse): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimers();
        resolve(result);
      };

      const data = JSON.stringify(payload);
      const transport = this.url.protocol === 'https:' ? https : http;
      const req = transport.request(
        this.url,
        {
          method: 'POST',
          agent: this.agent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'Idempotency-Key': key,
          },
        },
        (res) => {
          response = res;
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 65_536) {
              req.destroy(new BankTransportError('Phản hồi ngân hàng quá lớn.', true));
            } else {
              chunks.push(chunk);
            }
          });
          res.on('error', () =>
            fail(new BankTransportError('Mất kết nối khi đọc phản hồi ngân hàng.', true)),
          );
          res.on('aborted', () =>
            fail(new BankTransportError('Phản hồi ngân hàng bị cắt giữa chừng.', true)),
          );
          res.on('end', () => {
            try {
              const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              succeed({ code: res.statusCode ?? 0, body });
            } catch {
              fail(new BankTransportError('Ngân hàng trả JSON không hợp lệ.', true));
            }
          });
        },
      );

      req.on('socket', (socket) => {
        const markConnected = (): void => {
          connected = true;
          clearTimeout(connectTimer);
        };
        if (socket instanceof TLSSocket) {
          if (socket.authorized) {
            markConnected();
          } else {
            socket.once('secureConnect', markConnected);
          }
        } else if (!socket.connecting) {
          markConnected();
        } else {
          socket.once('connect', markConnected);
        }
      });
      req.on('error', (error: Error) => {
        fail(
          error instanceof BankTransportError
            ? error
            : new BankTransportError(error.message, connected),
        );
        response?.destroy();
      });
      // Các timer bao gồm cả thời gian chờ socket trong pool, DNS và đọc body.
      const connectTimer = setTimeout(
        () => {
          req.destroy(new BankTransportError('Không kết nối được tới ngân hàng.', false));
        },
        Math.min(this.config.connectTimeoutMs, budgetMs),
      );
      const deadlineTimer = setTimeout(
        () => {
          req.destroy(new BankTransportError('Hết thời gian chờ ngân hàng.', connected));
        },
        Math.min(this.config.attemptTimeoutMs, budgetMs),
      );
      req.end(data);
    });
  }
}
