const fs = require('fs');
const { execFile } = require('child_process');

const WSL_POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

const ACTIVATE_OR_LAUNCH_SCRIPT = [
  "$existing = Get-Process -Name CodexNative -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
  "if ($null -ne $existing) { $shell = New-Object -ComObject WScript.Shell; $null = $shell.AppActivate($existing.Id); Write-Output 'activated'; exit 0 }",
  "$exe = Join-Path $env:LOCALAPPDATA 'CodexNative\\CodexNative.exe'",
  "if (-not (Test-Path -LiteralPath $exe)) { Write-Error 'Codex Native is not installed in LocalAppData'; exit 2 }",
  "Start-Process -FilePath $exe",
  "Write-Output 'started'",
].join('; ');

function resolvePowerShell(platform = process.platform, existsSync = fs.existsSync) {
  if (platform === 'win32') return 'powershell.exe';
  if (platform === 'linux' && existsSync(WSL_POWERSHELL)) return WSL_POWERSHELL;
  return null;
}

function launchWindowsNativeDashboard({
  platform = process.platform,
  existsSync = fs.existsSync,
  execFileImpl = execFile,
} = {}) {
  const powershell = resolvePowerShell(platform, existsSync);
  if (!powershell) {
    const error = new Error('The Windows native dashboard can only be launched from Windows or WSL2.');
    error.code = 'NATIVE_LAUNCH_UNAVAILABLE';
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    execFileImpl(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ACTIVATE_OR_LAUNCH_SCRIPT],
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
  WSL_POWERSHELL,
  launchWindowsNativeDashboard,
  resolvePowerShell,
};
