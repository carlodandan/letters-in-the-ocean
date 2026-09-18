import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import Sitemap from 'vite-plugin-sitemap';

// The API runs as a separate Cloudflare Worker. Proxying it under /api keeps the
// browser on one origin in development, so the HttpOnly session cookie behaves
// exactly as it will in production behind Cloudflare Pages.
export default defineConfig({
  plugins: [
    react(),
    Sitemap({
      hostname: 'https://letters-in-the-ocean.eu.cc',
      dynamicRoutes: [
				'/',
				'/find',
				'/write',
				'/privacy',
			],

			priority: {
				'/': 1.0,
				'/find': 0.8,
				'/write': 0.7,
				'/privacy': 0.6,
			},
      readable: true,
      robots: [
        {
          userAgent: '*',
          allow: '/',
          disallow: ['/api', '/_worker/*'],
          crawlDelay: 2,
        },
      ],
    }),
  ],
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
