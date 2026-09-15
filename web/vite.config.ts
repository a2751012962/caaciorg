import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

// Hashed bundles go to /app/ so they never collide with the repo's /assets/
// (caaci-config.js, the Tabler pages' scripts), which build.mjs versions itself.
// `npm run dev` here serves the React app on :3000 and forwards the API, the
// runtime config and the login page to `npm run dev` at the repo root (:8788).
const backend = 'http://localhost:8788';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  build: { outDir: 'dist', assetsDir: 'app', emptyOutDir: true },
  server: {
    port: 3000,
    proxy: { '/api': backend, '/assets': backend, '/login-3': backend },
  },
});
