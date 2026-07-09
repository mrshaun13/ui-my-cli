const fs = require('fs');
const { execFile } = require('child_process');

const WSL_POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const MACOS_OPEN = '/usr/bin/open';

const ACTIVATE_OR_LAUNCH_SCRIPT = [
  "$existing = Get-Process -Name CodexNative -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
  "if ($null -ne $existing) { $shell = New-Object -ComObject WScript.Shell; $null = $shell.AppActivate($existing.Id); Write-Output 'activated'; exit 0 }",
  "$exe = Join-Path $env:LOCALAPPDATA 'Programs\\CodexNative\\CodexNative.exe'",
  "if (-not (Test-Path -LiteralPath $exe)) { Write-Error 'Codex Native is not installed in LocalAppData'; exit 2 }",
  "Start-Process -FilePath $exe",
  "Write-Output 'started'",
].join('; ');

function resolvePowerShell(platform = process.platform, existsSync = fs.existsSync) {
  if (platform === 'win32') return 'powershell.exe';
  if (platform === 'linux' && existsSync(WSL_POWERSHELL)) return WSL_POWERSHELL;
  return null;
}

function nativeLaunchCapability(platform = process.platform, existsSync = fs.existsSync) {
  if (platform === 'darwin' && existsSync(MACOS_OPEN)) {
    return { supported: true, platform: 'macos', label: 'Launch native app' };
  }
  if (resolvePowerShell(platform, existsSync)) {
    return { supported: true, platform: 'windows', label: 'Launch native app' };
  }
  return { supported: false, platform, label: 'Native app unavailable' };
}

function isTrustedLaunchRequest({ origin, host, fetchSite } = {}) {
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return false;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:'
      && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
      && parsed.host === host;
  } catch {
    return false;
  }
}

function launchNativeDashboard({
  platform = process.platform,
  existsSync = fs.existsSync,
  execFileImpl = execFile,
} = {}) {
  if (platform === 'darwin' && existsSync(MACOS_OPEN)) {
    return new Promise((resolve, reject) => {
      execFileImpl(
        MACOS_OPEN,
        ['-a', 'CodexNative'],
        { timeout: 5000, windowsHide: true },
        (error, _stdout, stderr) => {
          if (error) {
            const detail = String(stderr || error.message || '').trim();
            const wrapped = new Error(detail || 'macOS could not launch Codex Native.');
            wrapped.code = error.code;
            reject(wrapped);
            return;
          }
          resolve('started');
        },
      );
    });
  }

  const powershell = resolvePowerShell(platform, existsSync);
  if (!powershell) {
    const error = new Error('The native dashboard launcher is unavailable on this host.');
    error.code = 'NATIVE_LAUNCH_UNAVAILABLE';
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    execFileImpl(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ACTIVATE_OR_LAUNCH_SCRIPT],
      { timeout: 5000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message || '').trim();
          const wrapped = new Error(detail || 'Windows could not launch Codex Native.');
          wrapped.code = error.code;
          reject(wrapped);
          return;
        }
        resolve(String(stdout || '').trim() || 'started');
      },
    );
  });
}

module.exports = {
  ACTIVATE_OR_LAUNCH_SCRIPT,
  MACOS_OPEN,
  WSL_POWERSHELL,
  isTrustedLaunchRequest,
  launchNativeDashboard,
  nativeLaunchCapability,
  resolvePowerShell,
};
