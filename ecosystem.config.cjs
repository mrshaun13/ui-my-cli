/**
 * PM2 ecosystem config for Codex Dashboard.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs        # start (production build served by server)
 *   pm2 restart codex-dashboard           # restart after code changes
 *   pm2 stop codex-dashboard              # stop
 *   pm2 logs codex-dashboard              # tail logs
 *
 * The server runs in production mode: it serves the pre-built Vite output from
 * client/dist/. Run `npm run build` before starting if you've changed client code.
 *
 * Do NOT run `npm run dev` alongside this — it will fight over port 7575.
 */

module.exports = {
  apps: [
    {
      name: 'codex-dashboard',
      script: 'server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: '7575',
      },
      // Restart on crash, but not if it's crashing repeatedly (port conflict, etc.)
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 5,
      restart_delay: 1000,
      kill_timeout: 6000, // server graceful shutdown is 5s
      // Watch server/ directory only — client changes require a manual `npm run build`
      watch: false,
      // Log to pm2 default paths (~/.pm2/logs/)
      error_file: '~/.pm2/logs/codex-dashboard-error.log',
      out_file: '~/.pm2/logs/codex-dashboard-out.log',
      merge_logs: true,
    },
  ],
}
