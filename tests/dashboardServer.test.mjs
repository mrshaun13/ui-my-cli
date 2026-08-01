import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('server module imports without production runtime side effects', () => {
  const sigintListeners = process.listenerCount('SIGINT');
  const sigtermListeners = process.listenerCount('SIGTERM');
  const moduleExports = require('../server/index.js');

  assert.equal(typeof moduleExports.createDashboardServer, 'function');
  assert.equal(process.listenerCount('SIGINT'), sigintListeners);
  assert.equal(process.listenerCount('SIGTERM'), sigtermListeners);

  const loaded = Object.keys(require.cache);
  assert.equal(loaded.some(file => file.endsWith('/server/providers/index.js')), false);
  assert.equal(loaded.some(file => file.endsWith('/server/pty-manager.js')), false);
  assert.equal(loaded.some(file => file.endsWith('/server/native-launcher.js')), false);
  assert.equal(loaded.some(file => file.endsWith('/server/codex-app-server.js')), false);
});

test('injected dashboard listens on loopback and closes cleanly', async () => {
  const { createDashboardServer } = require('../server/index.js');
  const { createSyntheticRuntime, FIXTURE_MODE } = require('./fixtures/synthetic-dashboard-runtime.js');
  const dashboard = createDashboardServer({
    runtime: createSyntheticRuntime(),
    isDev: true,
  });

  const address = await dashboard.listen({ port: 0, host: '127.0.0.1' });
  assert.equal(address.address, '127.0.0.1');

  const response = await fetch(`http://127.0.0.1:${address.port}/api/status`);
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.fixtureMode, FIXTURE_MODE);
  assert.deepEqual(status.isolation, {
    blockedLoads: 0,
    filesystemWatches: 0,
    processSpawns: 0,
    realStateReads: 0,
  });

  await dashboard.close();
  assert.equal(dashboard.address(), null);
});
