import 'dotenv/config';
import { createBank } from './app.js';
import { bankConfig } from '../shared/config.js';
import { installShutdown } from '../shared/server.js';

const config = bankConfig();
const { server } = createBank(config);
server.on('error', (error: Error) => {
  console.error(`[bank] ${error.message}`);
  process.exitCode = 1;
});
server.listen(config.port, () => {
  console.log(`[bank] http://localhost:${config.port}`, config);
});
installShutdown(server);
