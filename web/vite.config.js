import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API runs as a separate Cloudflare Worker. Proxying it under /api keeps the
// browser on one origin in development, so the HttpOnly session cookie behaves
// exactly as it will in production behind Cloudflare Pages.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    cssTarget: 'safari16',
    sourcemap: true,
  },
});
