/// <reference types="vitest" />
import { existsSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// VITE_API_URL set: the browser calls the API directly (CORS with credentials; the cookie is same-site on localhost).
// VITE_API_URL empty: requests are same-origin and this dev server proxies them, which is also how one tunnel
// URL can serve both the app and the API.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.PROXY_TARGET || 'http://localhost:4000';
  return {
    plugins: [react()],
    // The pixel wordmark: public/logo.svg when it exists, otherwise the Silkscreen text fallback.
    define: { __HAS_LOGO__: JSON.stringify(existsSync('public/logo.svg')) },
    server: {
      port: 5173,
      allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.trycloudflare.com'],
      proxy: { '/api': target, '/admin': target },
    },
    test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], css: false, exclude: ['node_modules', 'scripts'] },
  };
});
