// Hermetic checks on the Supabase Auth email templates in supabase/templates/
// and on push-auth-emails.mjs, the script that copies them (with the non-secret
// SMTP settings) into the project's auth config.
//
// The live half — does the project still match these files? — is in
// auth-config.test.js and needs a Management API token. Everything here runs
// offline in `npm test`: templates are read from disk and fetch is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { mockFetch } from './helpers.js';
import {
  TEMPLATE_TYPES,
  buildAuthPatch,
  diffAuthConfig,
  loadTemplates,
  main,
} from '../push-auth-emails.mjs';

const TEMPLATES = new URL('../supabase/templates/', import.meta.url);
const read = (name) => readFile(new URL(name, TEMPLATES), 'utf8');

// Pinned here rather than taken from the script, so a renamed or dropped type
// fails a test instead of silently leaving a dashboard template unmanaged.
const TYPES = [
  'confirmation',
  'recovery',
  'invite',
  'magic_link',
  'email_change',
  'reauthentication',
];

// The dashboard's CSP img-src allows *.supabase.co but not caaciorg.com, so a
// logo hosted anywhere else renders as a broken image in the template preview.
const STORAGE = 'https://wslzeqhipvibeflmxznh.supabase.co/storage/v1/object/public/';

const REF_URL = 'https://api.supabase.com/v1/projects/wslzeqhipvibeflmxznh/config/auth';
const TOKEN = 'sbp_test_token_that_must_never_be_printed';

// Silences the script and hands back everything it printed.
function capture(t) {
  const lines = [];
  for (const m of ['log', 'error', 'warn']) {
    t.mock.method(console, m, (...args) => lines.push(args.join(' ')));
  }
  return lines;
}

const methods = (stub) => stub.calls.map((c) => c.options.method || 'GET');

// ---------------------------------------------------------------- templates

test('subjects.json and the template files cover exactly the six auth email types', async () => {
  const subjects = JSON.parse(await read('subjects.json'));
  assert.deepEqual(Object.keys(subjects).sort(), [...TYPES].sort());
  assert.deepEqual([...TEMPLATE_TYPES].sort(), [...TYPES].sort());

  // A stray .html would never be pushed; a missing one breaks the push.
  const html = (await readdir(TEMPLATES)).filter((f) => f.endsWith('.html'));
  assert.deepEqual(html.sort(), TYPES.map((t) => `${t}.html`).sort());
  for (const type of TYPES) assert.ok(subjects[type].trim(), `subject for ${type} is empty`);
});

test('each template carries the variable its flow depends on', async () => {
  // Without the link, the email arrives and nobody can act on it.
  for (const type of ['confirmation', 'recovery', 'invite', 'magic_link', 'email_change']) {
    assert.match(
      await read(`${type}.html`),
      /\{\{\s*\.ConfirmationURL\s*\}\}/,
      `${type}.html has no {{ .ConfirmationURL }}`,
    );
  }
  assert.match(await read('reauthentication.html'), /\{\{\s*\.Token\s*\}\}/);
  assert.match(await read('email_change.html'), /\{\{\s*\.NewEmail\s*\}\}/);
});

test('every image is served from Supabase Storage', async () => {
  for (const type of TYPES) {
    const html = await read(`${type}.html`);
    const tags = html.match(/<img\b[^>]*>/gi) || [];
    assert.ok(tags.length, `${type}.html has no logo`);
    for (const tag of tags) {
      const src = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || '';
      assert.ok(
        src.startsWith(STORAGE),
        `${type}.html: <img src="${src}"> is not on Supabase Storage — the dashboard preview will show it broken`,
      );
    }
  }
});

// ---------------------------------------------------------------- PATCH body

test('the PATCH body has every subject and template, the exact SMTP settings, and no smtp_pass', async () => {
  const body = buildAuthPatch(await loadTemplates());
  const subjects = JSON.parse(await read('subjects.json'));

  for (const type of TYPES) {
    assert.equal(body[`mailer_subjects_${type}`], subjects[type]);
    assert.equal(body[`mailer_templates_${type}_content`], await read(`${type}.html`));
  }

  // The password is a Resend API key: it lives in the dashboard and nowhere else.
  assert.equal('smtp_pass' in body, false);
  assert.deepEqual(
    Object.fromEntries(Object.entries(body).filter(([k]) => k.startsWith('smtp_'))),
    {
      smtp_admin_email: 'no-reply@caaciorg.com',
      smtp_host: 'smtp.resend.com',
      // A string: UpdateAuthConfigBody in the Management API's OpenAPI spec types it so.
      smtp_port: '465',
      smtp_user: 'resend',
      smtp_sender_name: 'CAACI',
      smtp_max_frequency: 60,
    },
  );
  assert.equal(Object.keys(body).length, TYPES.length * 2 + 6, 'unexpected extra keys');
});

// ---------------------------------------------------------------- diff

test('diff: a live config that already matches has nothing to change', async () => {
  const desired = buildAuthPatch(await loadTemplates());
  // Live config carries plenty of keys the script does not own.
  assert.deepEqual(
    diffAuthConfig(desired, { ...desired, site_url: 'https://x', smtp_pass: '' }),
    [],
  );

  // Line endings, trailing whitespace and a port read back as a number are not drift.
  const noisy = {
    ...desired,
    smtp_port: 465,
    mailer_templates_invite_content:
      desired.mailer_templates_invite_content.replace(/\n/g, '  \r\n') + '\n\n',
  };
  assert.deepEqual(diffAuthConfig(desired, noisy), []);
});

test('diff: one edited template is reported by its key alone, without dumping the HTML', async () => {
  const desired = buildAuthPatch(await loadTemplates());
  const live = {
    ...desired,
    mailer_templates_recovery_content: desired.mailer_templates_recovery_content.replace(
      'CAACI',
      'ACME',
    ),
  };
  const drift = diffAuthConfig(desired, live);
  assert.deepEqual(
    drift.map((d) => d.key),
    ['mailer_templates_recovery_content'],
  );
  assert.ok(drift[0].summary.length < 200, `summary too long: ${drift[0].summary}`);
  assert.doesNotMatch(drift[0].summary, /<div|<img/);
});

// ---------------------------------------------------------------- CLI

test('without a token it exits non-zero and makes no request', async (t) => {
  const out = capture(t);
  const stub = mockFetch(() => ({}));
  try {
    assert.equal(await main([], {}), 1);
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls.length, 0);
  assert.match(out.join('\n'), /SUPABASE_ACCESS_TOKEN/);
});

test('the dry run only reads, and lists the drifted keys', async (t) => {
  const out = capture(t);
  const desired = buildAuthPatch(await loadTemplates());
  const stub = mockFetch(() => ({ body: { ...desired, mailer_subjects_invite: 'old subject' } }));
  try {
    assert.equal(await main([], { SUPABASE_ACCESS_TOKEN: TOKEN }), 0);
  } finally {
    stub.restore();
  }
  assert.deepEqual(methods(stub), ['GET']);
  assert.equal(stub.calls[0].url, REF_URL);
  assert.equal(stub.calls[0].options.headers.authorization, `Bearer ${TOKEN}`);

  const text = out.join('\n');
  assert.match(text, /mailer_subjects_invite/);
  assert.doesNotMatch(text, /mailer_templates_/);
  assert.match(text, /--apply/);
  assert.equal(text.includes(TOKEN), false, 'the token was printed');
});

test('SBP and SB_REF work as they do for apply-supabase.mjs', async (t) => {
  capture(t);
  const desired = buildAuthPatch(await loadTemplates());
  const stub = mockFetch(() => ({ body: desired }));
  try {
    assert.equal(await main([], { SBP: TOKEN, SB_REF: 'otherref' }), 0);
  } finally {
    stub.restore();
  }
  assert.equal(stub.calls[0].url, 'https://api.supabase.com/v1/projects/otherref/config/auth');
  assert.equal(stub.calls[0].options.headers.authorization, `Bearer ${TOKEN}`);
});

test('--apply PATCHes only the drifted keys, then re-reads and confirms', async (t) => {
  const out = capture(t);
  const desired = buildAuthPatch(await loadTemplates());
  // The live config reads smtp_pass back; it must never be written back.
  let live = {
    ...desired,
    smtp_pass: 'REDACTED',
    mailer_templates_recovery_content: 'stale',
    smtp_sender_name: 'Old',
  };
  const stub = mockFetch((url, options) => {
    if (options.method === 'PATCH') live = { ...live, ...JSON.parse(options.body) };
    return { body: live };
  });
  try {
    assert.equal(await main(['--apply'], { SUPABASE_ACCESS_TOKEN: TOKEN }), 0);
  } finally {
    stub.restore();
  }
  assert.deepEqual(methods(stub), ['GET', 'PATCH', 'GET']);
  assert.equal(stub.calls[1].url, REF_URL);
  const sent = JSON.parse(stub.calls[1].options.body);
  assert.deepEqual(Object.keys(sent).sort(), [
    'mailer_templates_recovery_content',
    'smtp_sender_name',
  ]);
  assert.equal(sent.smtp_sender_name, 'CAACI');
  assert.equal('smtp_pass' in sent, false, 'smtp_pass was sent');
  assert.match(out.join('\n'), /smtp_pass/, 'should say loudly that the password is not sent');
  assert.equal(out.join('\n').includes(TOKEN), false, 'the token was printed');
});

test('--apply exits non-zero when the re-read config still differs', async (t) => {
  const out = capture(t);
  const desired = buildAuthPatch(await loadTemplates());
  const live = { ...desired, mailer_subjects_magic_link: 'stale' };
  // Accepts the PATCH but does not change anything.
  const stub = mockFetch(() => ({ body: live }));
  try {
    assert.equal(await main(['--apply'], { SUPABASE_ACCESS_TOKEN: TOKEN }), 1);
  } finally {
    stub.restore();
  }
  assert.deepEqual(methods(stub), ['GET', 'PATCH', 'GET']);
  assert.match(out.join('\n'), /mailer_subjects_magic_link/);
});

test('--apply will not switch on SMTP it cannot give a password to', async (t) => {
  const out = capture(t);
  const desired = buildAuthPatch(await loadTemplates());
  // Only the host is missing, so a guard keyed on any other SMTP field lets this through.
  const stub = mockFetch(() => ({ body: { ...desired, smtp_host: null } }));
  try {
    assert.equal(await main(['--apply'], { SUPABASE_ACCESS_TOKEN: TOKEN }), 1);
  } finally {
    stub.restore();
  }
  assert.deepEqual(methods(stub), ['GET'], 'only SMTP differed, so nothing should be written');
  const text = out.join('\n');
  assert.match(text, /smtp\.resend\.com/);
  assert.equal(text.includes(TOKEN), false, 'the token was printed');
});

test('--apply will not repoint another SMTP provider at Resend, but still applies templates', async (t) => {
  const out = capture(t);
  const desired = buildAuthPatch(await loadTemplates());
  // That provider's password stays in place, so Resend's host and user would break every email.
  let live = {
    ...desired,
    smtp_host: 'smtp.sendgrid.net',
    smtp_port: '587',
    smtp_user: 'apikey',
    smtp_pass: 'REDACTED',
    mailer_subjects_invite: 'old subject',
  };
  const stub = mockFetch((url, options) => {
    if (options.method === 'PATCH') live = { ...live, ...JSON.parse(options.body) };
    return { body: live };
  });
  try {
    // Still non-zero: the SMTP settings the repo asks for are not in place.
    assert.equal(await main(['--apply'], { SUPABASE_ACCESS_TOKEN: TOKEN }), 1);
  } finally {
    stub.restore();
  }
  assert.deepEqual(methods(stub), ['GET', 'PATCH', 'GET']);
  assert.deepEqual(Object.keys(JSON.parse(stub.calls[1].options.body)), ['mailer_subjects_invite']);
  assert.equal(live.smtp_host, 'smtp.sendgrid.net');
  const text = out.join('\n');
  assert.match(text, /smtp\.sendgrid\.net/);
  assert.equal(text.includes(TOKEN), false, 'the token was printed');
});

test('an HTTP error exits non-zero, writes nothing and does not echo the token', async (t) => {
  const out = capture(t);
  const stub = mockFetch(() => ({ status: 401, body: `bad token ${TOKEN}` }));
  try {
    assert.equal(await main(['--apply'], { SUPABASE_ACCESS_TOKEN: TOKEN }), 1);
  } finally {
    stub.restore();
  }
  assert.deepEqual(methods(stub), ['GET']);
  const text = out.join('\n');
  assert.match(text, /401/);
  assert.equal(text.includes(TOKEN), false, 'the token was printed');
});
