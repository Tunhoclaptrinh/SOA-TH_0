import 'dotenv/config';
import { createFee } from './app.js';
import { feeConfig } from '../shared/config.js';
import { installShutdown } from '../shared/server.js';

const config = feeConfig();
const { server, close } = createFee(config);
server.on('error', (error: Error) => {
  console.error(`[fee] ${error.message}`);
  close();
  process.exitCode = 1;
});
server.listen(config.port, () => {
  console.log(`[fee] http://localhost:${config.port}; bank=${config.bankUrl}`);
});
installShutdown(server, close);
