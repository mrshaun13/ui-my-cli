import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,

    // ── Security: bind dev server to loopback only ────────────────────────
    // Vite has had two CVE-class issues in the >= 6.0.0, <= 6.4.1 range that
    // are ONLY exploitable when the dev server is reachable over the network:
    //
    //   • GHSA — fetchModule via WebSocket bypasses server.fs.allow,
    //     allowing arbitrary file read.
    //   • GHSA — `.map` path-traversal under optimized-deps URLs allows
    //     reading any sourcemap-shaped file outside the project root.
    //
    // We're patched to 6.4.2 (which fixes both), but pinning the bind to
    // 127.0.0.1 here defends against (a) a future regression and (b) a
    // future contributor running `npm run dev -- --host 0.0.0.0` to hit
    // the dev server from another machine.  This dashboard is a
    // single-user tool — the dev server should never be on the network.
    //
    // If you genuinely need to expose the dev server (e.g. testing from a
    // phone on the same LAN), do it deliberately by setting host here,
    // not via a CLI flag, so the choice is reviewed and committed.
    host: '127.0.0.1',

    proxy: {
      '/api': 'http://localhost:7575',
      '/ws': {
        target: 'ws://localhost:7575',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
        },
      },
    },
  },
})
