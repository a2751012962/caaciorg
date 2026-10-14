import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { anthropic } from '@ai-sdk/anthropic';

// Where the site under test lives. Unset, the runner uses the local build on
// :8788 (`npm run dev` in the repo root), starting it when nothing answers
// there yet. Set APP_URL to point the same suite at another copy.
//
// Whatever the URL, the local build talks to the LIVE Supabase project
// (wrangler.toml), so every test here only reads: no sign-ups, no form
// submissions, no payments.
const APP_URL = process.env.APP_URL;

// The named variables that are set, as strings, for the app command.
const passEnv = (names: string[]): Record<string, string> =>
  Object.fromEntries(names.flatMap((n) => (process.env[n] ? [[n, process.env[n]]] : [])));

// Facts every model call should know about this site: act turns and the
// judges behind agent.assert alike.
const vocabulary = [
  'CAACI is the Chinese American Association of Central Illinois.',
  'The site is bilingual: English at /, Chinese under /zh/.',
  'The "中" / "En" pill in the header switches the language.',
  'Membership tiers and dues are on /membership/; events on /events/.',
  'Signing in happens on the Log In page; /account/ needs a signed-in member.',
].join(' ');

export default {
  tests: ['tests/**/*.e2e.ts'],
  targets: [
    {
      name: 'site',
      // A fixed locale and time zone, so the first visit lands on English
      // and event dates read the same on every machine.
      engine: web({ locale: 'en-US', timezoneId: 'America/Chicago' }),
      app: APP_URL
        ? { url: APP_URL }
        : {
            url: 'http://127.0.0.1:8788',
            command: {
              executable: process.execPath,
              args: ['start-site.mjs'],
              reuseExisting: true,
              // The runner hands the command only PATH, HOME and the temp
              // variables; npm and wrangler on Windows look for their config
              // under the profile folders. Unset entries are dropped.
              env: passEnv(['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'ComSpec']),
              // build.mjs builds web/ and the mirror before wrangler listens
              startupTimeout: 180_000,
              log: '.e2e/logs/site.log',
            },
          },
    },
  ],
  // Agent steps need a model; the smoke suite does not. Without a key the
  // agent suite fails with MODEL_UNAVAILABLE instead of guessing.
  ...(process.env.ANTHROPIC_API_KEY
    ? { agents: { default: { model: anthropic('claude-sonnet-5-5'), context: vocabulary } } }
    : {}),
} satisfies E2EConfig;
