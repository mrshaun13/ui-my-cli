'use strict';

const path = require('node:path');
const { createDashboardServer } = require('../../server/index');
const { createSyntheticRuntime } = require('./synthetic-dashboard-runtime');

if (!globalThis.__UI_MY_CLI_ISOLATION_GUARD__) {
  throw new Error('The isolated dashboard must start with tests/fixtures/isolation-guard.cjs preloaded');
}

const port = parseInt(process.env.PORT || '4174', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 7575) {
  throw new Error(`Refusing unsafe isolated Playwright port: ${process.env.PORT || port}`);
}

const dashboard = createDashboardServer({
  runtime: createSyntheticRuntime(),
  isDev: false,
  clientDist: path.resolve(__dirname, '..', '..', 'client', 'dist'),
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await dashboard.close();
    process.exit(0);
  } catch (error) {
    console.error(`[isolated-dashboard] shutdown failed: ${error.message}`);
    process.exit(1);
  }
}

dashboard.listen({
  port,
  host: '127.0.0.1',
  validatePtyOnStart: false,
  watchProviders: false,
}).then(() => {
  console.log(`[isolated-dashboard] ready at http://127.0.0.1:${port}`);
}).catch(error => {
  console.error(`[isolated-dashboard] startup failed: ${error.message}`);
  process.exit(1);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
