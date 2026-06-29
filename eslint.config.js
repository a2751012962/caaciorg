import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';

// Flat config. Three runtimes live in this repo, each with its own globals:
//   - src/**        → browser (the progressive-enhancement client)
//   - functions/**  → Cloudflare Pages Functions (Workers runtime)
//   - *.mjs         → Node build/tooling scripts
export default defineConfig([
  // Vendored third-party bundle (Supabase UMD) — not our code; don't lint it.
  { ignores: ['dist/', 'mirror/', 'node_modules/', 'src/supabase.js'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.browser },
  },
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker },
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  },
  {
    // Unit tests run under `node --test` but drive a jsdom DOM, so they touch
    // both Node and browser globals.
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
]);
