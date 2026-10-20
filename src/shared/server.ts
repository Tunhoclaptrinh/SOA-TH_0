import http from 'node:http';
import type { Socket } from 'node:net';

interface ServerOptions {
  onConnection?: (socket: Socket) => void;
}

export function createServer(
  app: http.RequestListener,
  { onConnection }: ServerOptions = {},
): http.Server {
  const server = http.createServer(app);
  server.keepAliveTimeout = 5000;
  // Buffer này có trên Node mới; giữ đúng hạn nhàn rỗi 5 giây của đề.
  if ('keepAliveTimeoutBuffer' in server) {
    server.keepAliveTimeoutBuffer = 0;
  }
  if (onConnection) {
    server.on('connection', onConnection);
  }
  return server;
}

export function installShutdown(server: http.Server, cleanup: () => void = () => {}): void {
  let stopping = false;
  const stop = (): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    const timer = setTimeout(() => {
      cleanup();
      server.closeAllConnections();
    }, 5000);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      cleanup();
    });
    server.closeIdleConnections();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
