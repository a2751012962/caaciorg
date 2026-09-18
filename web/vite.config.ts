import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { googleFontLinks } from '../src/caaci-shared.js';

// Hashed bundles go to /app/ so they never collide with the repo's /assets/
// (caaci-config.js, the Tabler pages' scripts), which build.mjs versions itself.
// `npm run dev` here serves the React app on :3000 and forwards the API, the
// runtime config and the login page to `npm run dev` at the repo root (:8788).
const backend = 'http://localhost:8788';

// The site's one Google Fonts link (Poppins, the only web font left)
// goes into index.html at <!--CAACI_FONTS-->, from the same constant build.mjs
// writes into the Tabler pages, so the two kinds of page cannot drift apart.
const caaciFonts = (): Plugin => ({
  name: 'caaci-fonts',
  transformIndexHtml(html) {
    if (!html.includes('<!--CAACI_FONTS-->'))
      throw new Error('index.html: missing <!--CAACI_FONTS-->');
    return html.replace('<!--CAACI_FONTS-->', googleFontLinks());
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), caaciFonts()],
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  build: { outDir: 'dist', assetsDir: 'app', emptyOutDir: true },
  server: {
    port: 3000,
    proxy: { '/api': backend, '/assets': backend, '/login-3': backend },
  },
});
