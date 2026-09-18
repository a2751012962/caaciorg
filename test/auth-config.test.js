// Contract tests for the LIVE Supabase auth configuration — the half of sign-in
// that lives in Supabase's own settings rather than in this repo, and that
// nothing else in the suite would notice breaking:
//
//   * a provider switched off in the dashboard
//   * the wrong OAuth client id pasted in
//   * Microsoft pointed at a single tenant instead of /common, locking out
//     every member who does not have a caaciorg account
//   * a return URL dropping out of the redirect allow list
//   * custom SMTP switched off, after which Supabase's built-in mailer delivers
//     only to the project team's own addresses
//   * an auth email template or subject edited in the dashboard, drifting from
//     supabase/templates/ (push-auth-emails.mjs puts it back)
//
// Two groups, with different requirements:
//
//   AUTHORIZE  — hits the public /auth/v1/authorize endpoint. No credentials of
//                any kind. Enabled with CAACI_AUTH_CONFIG_TESTS=1.
//   CONFIG     — reads the project's auth config over the Management API.
//                Needs SUPABASE_ACCESS_TOKEN (a personal access token; SBP
//                also works, as in the push scripts).
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
import { buildAuthPatch, diffAuthConfig, loadTemplates } from '../push-auth-emails.mjs';

const AUTHORIZE_ON = process.env.CAACI_AUTH_CONFIG_TESTS === '1';
const skipAuthorize = AUTHORIZE_ON
  ? false
  : 'set CAACI_AUTH_CONFIG_TESTS=1 to run (makes live requests to the Supabase auth endpoint)';

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || process.env.SBP || '';
const skipConfig = ACCESS_TOKEN
  ? false
  : 'set SUPABASE_ACCESS_TOKEN (or SBP) to run (reads the project auth config over the Management API)';

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

// One request for the whole CONFIG group. The promise is kept even when it
// rejects, so a bad token fails every test with the same message instead of
// asking the API again for each one.
let configRequest;
function authConfig() {
  configRequest ??= (async () => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (res.status === 401 || res.status === 403) {
      assert.fail(
        `Management API returned HTTP ${res.status}: SUPABASE_ACCESS_TOKEN was rejected or has ` +
          'expired. Create a new personal access token at ' +
          'https://supabase.com/dashboard/account/tokens and update the secret.',
      );
    }
    assert.equal(res.status, 200, `Management API returned HTTP ${res.status}`);
    return res.json();
  })();
  return configRequest;
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

// The Mobile number tab on /login-3/ and the mobile-number section on /account/
// send their codes through Supabase's Phone provider, which delivers via Twilio.
// The credentials are secrets: only that they are set is checked, never a value,
// and no failure message can print one.
test('phone sign-in is enabled and delivers through Twilio', { skip: skipConfig }, async () => {
  const cfg = await authConfig();

  assert.equal(
    cfg.external_phone_enabled,
    true,
    'the Phone provider is switched off — the login page cannot text sign-in codes',
  );
  assert.equal(cfg.sms_provider, 'twilio');
  assert.ok(cfg.sms_twilio_account_sid, 'no Twilio Account SID');
  assert.ok(cfg.sms_twilio_auth_token, 'no Twilio Auth Token');
  assert.ok(
    cfg.sms_twilio_message_service_sid,
    'no Twilio Messaging Service SID — that is the sender the texts go out from',
  );
  assert.match(String(cfg.sms_template || ''), /\{\{\s*\.Code\s*\}\}/, 'the SMS carries no code');

  // Both code fields accept 6–10 digits (pattern="[0-9]{6,10}"), so a code
  // outside that range could never be typed in.
  const length = Number(cfg.sms_otp_length);
  assert.ok(length >= 6 && length <= 10, `SMS OTP length is ${cfg.sms_otp_length}, not 6–10`);

  // Phone confirmations are OFF by decision: the number given when registering
  // (0025's signup trigger) and one added under Account Security are saved at
  // once, without a texted code — the code at sign-in is the only check. With
  // them on, Account Security would start asking for a code (the page handles
  // it) and 0025's trigger would claim numbers Supabase then treats as pending;
  // SETUP.md describes the off state.
  assert.equal(
    cfg.sms_autoconfirm,
    true,
    '"Enable phone confirmations" was switched on under Authentication → Sign In / Providers → Phone — the site is built for it off; switch it back, or update Account Security, 0025 and SETUP.md',
  );
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

// The password is deliberately left alone: it is a secret, reading it back
// proves nothing about whether Resend accepts it, and a failure message here
// must never be able to print it. Only the public fields are compared.
test('custom SMTP sends as CAACI through Resend', { skip: skipConfig }, async () => {
  const cfg = await authConfig();

  assert.equal(
    cfg.smtp_host,
    'smtp.resend.com',
    "custom SMTP is off or points elsewhere — Supabase's built-in mailer only reaches the project team",
  );
  // As text: the docs do not say whether the port reads back as a number or a string.
  assert.equal(String(cfg.smtp_port), '465');
  assert.equal(cfg.smtp_user, 'resend');
  assert.equal(cfg.smtp_admin_email, 'no-reply@caaciorg.com', 'the From address changed');
  assert.equal(cfg.smtp_sender_name, 'CAACI', 'the From name changed');
});

// Compares with the same normalisation the push script uses — line endings and
// trailing whitespace only — so what fails here is exactly what --apply fixes.
test(
  'live email templates and subjects match supabase/templates/',
  { skip: skipConfig },
  async () => {
    const cfg = await authConfig();
    const repo = Object.fromEntries(
      Object.entries(buildAuthPatch(await loadTemplates())).filter(([key]) =>
        key.startsWith('mailer_'),
      ),
    );

    const drift = diffAuthConfig(repo, cfg);
    assert.deepEqual(
      drift.map((d) => d.key),
      [],
      `${drift.length} auth email setting(s) drifted from supabase/templates/:\n` +
        drift.map((d) => `  ${d.key}: ${d.summary}`).join('\n') +
        '\nRun `npm run auth:emails` (a dry run) to see the difference. If the repo is right, ' +
        'push it with `npm run auth:emails -- --apply`; if the dashboard is, copy it into the repo.',
    );
  },
);
