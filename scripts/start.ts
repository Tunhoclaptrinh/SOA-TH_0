import 'dotenv/config';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// TS khi chạy dev, JS khi chạy bản build. URL tương đối không phụ thuộc cwd.
const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const children = ['bank', 'fee'].map((service) => {
  const entrypoint = new URL(`../src/${service}/server.${extension}`, import.meta.url);
  const runtimeArgs = extension === 'ts' ? ['--import', 'tsx'] : [];
  return spawn(process.execPath, [...runtimeArgs, fileURLToPath(entrypoint)], {
    stdio: 'inherit',
    env: process.env,
  });
});

let stopping = false;
function stop(code = 0): void {
  if (stopping) {
    return;
  }
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    child.kill('SIGTERM');
  }
}
for (const child of children) {
  child.on('error', (error: Error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      stop(code ?? (signal ? 1 : 0));
    }
  });
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
