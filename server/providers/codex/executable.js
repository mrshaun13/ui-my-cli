/**
 * Resolves Codex for desktop processes that do not inherit a login-shell PATH.
 * CODEX_BIN remains the explicit override; common user and package-manager
 * locations are deterministic fallbacks before delegating to the OS PATH.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCodexExecutable({
  configuredPath = process.env.CODEX_BIN,
  pathValue = process.env.PATH,
  homeDirectory = process.env.HOME || os.homedir(),
  platform = process.platform,
  executableExists = isExecutable,
  listDirectories = directory => fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(directory, entry.name)),
} = {}) {
  if (configuredPath) return configuredPath;

  const executableName = platform === 'win32' ? 'codex.exe' : 'codex';
  const candidates = [path.join(homeDirectory, '.local', 'bin', executableName)];
  for (const directory of (pathValue || '').split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(directory, executableName));
  }
  if (platform === 'darwin') {
    candidates.push(`/opt/homebrew/bin/${executableName}`, `/usr/local/bin/${executableName}`);
  }

  const nvmRoot = path.join(homeDirectory, '.nvm', 'versions', 'node');
  try {
    candidates.push(...listDirectories(nvmRoot)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map(directory => path.join(directory, 'bin', executableName)));
  } catch {
    // nvm is optional.
  }

  return [...new Set(candidates)].find(executableExists) || executableName;
}

module.exports = { resolveCodexExecutable };
