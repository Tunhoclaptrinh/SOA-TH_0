import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';

export interface JsonResult<T = Record<string, unknown>> {
  code: number;
  body: T;
  ms: number;
}

export interface JsonRequestOptions {
  method?: string;
  body?: unknown;
  headers?: http.OutgoingHttpHeaders;
  agent?: http.Agent | false;
  timeoutMs?: number;
  rawBody?: string;
}

/** Client dành cho test/benchmark; T là hợp đồng response mà caller kiểm thử. */
export function jsonRequest<T = Record<string, unknown>>(
  url: string,
  {
    method = 'GET',
    body,
    headers = {},
    agent = false,
    timeoutMs = 20_000,
    rawBody,
  }: JsonRequestOptions = {},
): Promise<JsonResult<T>> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const data = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
    const transport = new URL(url).protocol === 'https:' ? https : http;
    const req = transport.request(
      url,
      {
        method,
        agent,
        headers: {
          ...(data === undefined
            ? {}
            : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('error', (error: Error) => {
          clearTimeout(timer);
          reject(error);
        });
        res.on('aborted', () => {
          clearTimeout(timer);
          reject(new Error('Response aborted'));
        });
        res.on('end', () => {
          clearTimeout(timer);
          try {
            const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve({
              code: res.statusCode ?? 0,
              body: parsed as T,
              ms: performance.now() - start,
            });
          } catch (error: unknown) {
            reject(error instanceof Error ? error : new Error('Không đọc được JSON.'));
          }
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error(`Client timeout ${timeoutMs}ms`)),
      timeoutMs,
    );
    req.on('error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.end(data);
  });
}
