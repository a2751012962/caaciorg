// Contract tests for the LIVE Supabase auth configuration — the half of sign-in
// that lives in Supabase's own settings rather than in this repo, and that
// nothing else in the suite would notice breaking:
//
//   * a provider switched off in the dashboard
//   * the wrong OAuth client id pasted in
//   * Microsoft pointed at a single tenant instead of /common, locking out
//     every member who does not have a caaciorg account
//   * a return URL dropping out of the redirect allow list
//
// Two groups, with different requirements:
//
//   AUTHORIZE  — hits the public /auth/v1/authorize endpoint. No credentials of
//                any kind. Enabled with CAACI_AUTH_CONFIG_TESTS=1.
//   CONFIG     — reads the project's auth config over the Management API.
//                Needs SUPABASE_ACCESS_TOKEN (a personal access token).
//
// Both are opt-in so `npm test` stays hermetic and offline. CI runs them in
// their own job (.github/workflows/auth-config.yml), including on a daily
// schedule so a change made in the dashboard is caught without a code push.
//
// NOTE ON WHAT AUTHORIZE CANNOT TELL YOU: /authorize echoes whatever
// redirect_to it is given, verbatim, without consulting the allow list — a
// request carrying redirect_to=https://evil.example/steal comes back with that
// value intact. GoTrue applies the allow list later, when it redirects the
// browser after the provider's callback, which cannot be exercised without
// completing a real sign-in. So the allow list is asserted in the CONFIG group
// against the stored setting, not inferred from an authorize response.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const AUTHORIZE_ON = process.env.CAACI_AUTH_CONFIG_TESTS === '1';
const skipAuthorize = AUTHORIZE_ON
  ? false
  : 'set CAACI_AUTH_CONFIG_TESTS=1 to run (makes live requests to the Supabase auth endpoint)';

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const skipConfig = ACCESS_TOKEN
  ? false
  : 'set SUPABASE_ACCESS_TOKEN to run (reads the project auth config over the Management API)';

// All public values. The client ids especially are not secrets — they are handed
// to the browser on every sign-in and appear in the redirect URL below. Pinning
// them is the point: a change should surface as a failing contract test rather
// than as a silent surprise.
const SUPABASE_URL = (
  process.env.SUPABASE_URL || 'https://wslzeqhipvibeflmxznh.supabase.co'
).replace(/\/+$/, '');
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || new URL(SUPABASE_URL).host.split('.')[0];
const SITE_URL = (process.env.CAACI_SITE_URL || 'https://caaci-8s2.pages.dev').replace(/\/+$/, '');
const GOOGLE_CLIENT_ID =
  process.env.CAACI_GOOGLE_CLIENT_ID ||
  '1093657798336-fv16etrcu3nnm6k6dfqkqm86dte10dv9.apps.googleusercontent.com';
const AZURE_CLIENT_ID = process.env.CAACI_AZURE_CLIENT_ID || 'faf7b55b-a98a-4e5e-a7ef-511f06474f40';

const CALLBACK = `${SUPABASE_URL}/auth/v1/callback`;

// Ask GoTrue to start a sign-in and hand back the 302 it would send the browser.
async function authorize({ provider, redirectTo, scopes }) {
  const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  url.searchParams.set('provider', provider);
  if (redirectTo) url.searchParams.set('redirect_to', redirectTo);
  if (scopes) url.searchParams.set('scopes', scopes);

  const res = await fetch(url, { redirect: 'manual' });
  const location = res.headers.get('location');
  assert.equal(
    res.status,
    302,
    `expected a redirect to the provider, got HTTP ${res.status} — is the ${provider} provider enabled?`,
  );
  assert.ok(location, 'no Location header on the 302');
  return new URL(location);
}

let configCache;
async function authConfig() {
  if (configCache) return configCache;
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  assert.equal(res.status, 200, `Management API returned HTTP ${res.status}`);
  configCache = await res.json();
  return configCache;
}

// ---------------------------------------------------------------- AUTHORIZE

test(
  'google sign-in redirects to Google with the expected client',
  { skip: skipAuthorize },
  async () => {
    const to = await authorize({ provider: 'google', redirectTo: `${SITE_URL}/account/` });

    assert.equal(to.host, 'accounts.google.com');
    assert.equal(to.searchParams.get('client_id'), GOOGLE_CLIENT_ID);
    assert.equal(to.searchParams.get('redirect_uri'), CALLBACK);
    assert.equal(to.searchParams.get('response_type'), 'code');

    // Google's defaults must still carry the claims handle_new_user reads.
    const scope = to.searchParams.get('scope') || '';
    assert.match(scope, /\bemail\b/);
    assert.match(scope, /\bprofile\b/);
  },
);

test(
  'microsoft sign-in redirects to the multi-tenant endpoint',
  { skip: skipAuthorize },
  async () => {
    const to = await authorize({ provider: 'azure', redirectTo: `${SITE_URL}/account/` });

    assert.equal(to.host, 'login.microsoftonline.com');
    assert.equal(
      to.pathname,
      '/common/oauth2/v2.0/authorize',
      '/common is what lets any organisation and any personal Microsoft account sign in',
    );
    assert.equal(to.searchParams.get('client_id'), AZURE_CLIENT_ID);
    assert.equal(to.searchParams.get('redirect_uri'), CALLBACK);
    assert.equal(to.searchParams.get('response_type'), 'code');
  },
);

test(
  'microsoft honours the email/profile scopes the client sends',
  { skip: skipAuthorize },
  async () => {
    // The server half of the contract pinned in oauth-buttons.test.js: the browser
    // appends ?scopes=…, and GoTrue must pass them through to Microsoft. Without
    // email there is no email claim, and GoTrue rejects the sign-in because
    // external_azure_email_optional is false.
    const to = await authorize({
      provider: 'azure',
      redirectTo: `${SITE_URL}/account/`,
      scopes: 'openid email profile',
    });

    const scope = to.searchParams.get('scope') || '';
    assert.match(scope, /\bopenid\b/);
    assert.match(scope, /\bemail\b/);
    assert.match(scope, /\bprofile\b/);
  },
);

// ------------------------------------------------------------------- CONFIG

test('both providers are enabled with the expected clients', { skip: skipConfig }, async () => {
  const cfg = await authConfig();

  assert.equal(cfg.external_google_enabled, true, 'Google sign-in is switched off');
  assert.equal(cfg.external_google_client_id, GOOGLE_CLIENT_ID);

  assert.equal(cfg.external_azure_enabled, true, 'Microsoft sign-in is switched off');
  assert.equal(cfg.external_azure_client_id, AZURE_CLIENT_ID);
  assert.equal(
    cfg.external_azure_url,
    'https://login.microsoftonline.com/common',
    'a tenant-specific URL locks out every member without a caaciorg account',
  );

  // Email/password sign-in is the fallback for anyone who wants neither.
  assert.equal(cfg.external_email_enabled, true);
  assert.equal(cfg.disable_signup, false, 'new members could not register');
});

// Deliberately asserts the invariant rather than a specific hostname: the
// canonical domain is expected to change (pages.dev today, the custom domain
// later), and a test pinned to one of them would just have to be edited every
// time — which is how a test stops meaning anything. What must always hold is
// that site_url is somewhere real and allow-listed.
test('site_url is allow-listed and actually serves', { skip: skipConfig }, async () => {
  const cfg = await authConfig();
  const siteUrl = String(cfg.site_url || '').replace(/\/+$/, '');
  assert.ok(siteUrl, 'site_url is empty');

  const entries = String(cfg.uri_allow_list || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  assert.ok(entries.length, 'the redirect allow list is empty — every OAuth return is rewritten');

  // OAuth returns land on arbitrary paths: /account/ after a plain sign-in, but
  // also whatever page the checkout overlay was opened from, query string and
  // all. A bare-origin entry would not cover those, so require a glob.
  const host = new URL(siteUrl).host;
  assert.ok(
    entries.some((e) => e.includes(host) && e.endsWith('/**')),
    `no entry covers ${host} with a /** glob — deep return URLs would be rewritten to site_url.\nallow list: ${entries.join(', ')}`,
  );

  // site_url is the fallback GoTrue uses for anyone whose return URL it does not
  // accept, and the base for confirmation and password-reset links. Pointing it
  // at a host that does not resolve strands those visitors on a dead domain,
  // which no amount of correct provider configuration will save.
  let status = 0;
  try {
    status = (await fetch(siteUrl, { redirect: 'follow' })).status;
  } catch (err) {
    assert.fail(`site_url ${siteUrl} is not reachable: ${err.cause?.code || err.message}`);
  }
  assert.equal(status, 200, `site_url ${siteUrl} answered HTTP ${status}`);
});
