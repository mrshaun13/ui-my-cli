'use strict';

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const blockedRequests = new Set([
  'better-sqlite3',
  'node-pty',
  'child_process',
  'node:child_process',
]);
const blockedFiles = new Set([
  path.join(PROJECT_ROOT, 'server', 'providers', 'index.js'),
  path.join(PROJECT_ROOT, 'server', 'pty-manager.js'),
  path.join(PROJECT_ROOT, 'server', 'native-launcher.js'),
  path.join(PROJECT_ROOT, 'server', 'codex-app-server.js'),
]);

const counters = {
  blockedLoads: 0,
  filesystemWatches: 0,
  processSpawns: 0,
  realStateReads: 0,
};
globalThis.__UI_MY_CLI_ISOLATION_GUARD__ = counters;

const originalLoad = Module._load;
Module._load = function guardedLoad(request, parent, isMain) {
  let resolved = null;
  try {
    resolved = Module._resolveFilename(request, parent, isMain);
  } catch {
    // Preserve Node's normal module-not-found error below.
  }
  if (blockedRequests.has(request) || (resolved && blockedFiles.has(resolved))) {
    counters.blockedLoads += 1;
    if (request === 'child_process' || request === 'node:child_process') {
      counters.processSpawns += 1;
    } else {
      counters.realStateReads += 1;
    }
    throw new Error(`Isolated Playwright server blocked unsafe module: ${request}`);
  }
  return originalLoad.call(this, request, parent, isMain);
};

for (const name of ['watch', 'watchFile']) {
  fs[name] = function blockedFilesystemWatch() {
    counters.filesystemWatches += 1;
    throw new Error(`Isolated Playwright server blocked fs.${name}()`);
  };
}
