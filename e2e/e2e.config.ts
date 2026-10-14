import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

// Where the site under test lives: the local build on :8788 by default, so
// start `npm run dev` in the repo root first. Set APP_URL to point the same
// suite at another copy.
//
// Whatever the URL, the local build talks to the LIVE Supabase project
// (wrangler.toml), so every test here only reads: no sign-ups, no form
// submissions, no payments.
const APP_URL = process.env.APP_URL;

export default {
  tests: ['tests/**/*.e2e.ts'],
  targets: [
    {
      name: 'site',
      // A fixed locale, so a first visit lands on the English pages.
      engine: web({ locale: 'en-US' }),
      app: { url: APP_URL ?? 'http://127.0.0.1:8788' },
    },
  ],
} satisfies E2EConfig;
