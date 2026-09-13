// push-auth-emails.mjs — makes the project's Supabase Auth emails match the repo.
//
// Copies the six templates in supabase/templates/ (subjects from subjects.json)
// and the non-secret custom-SMTP settings into the project's auth config over
// the Management API.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=<personal access token> npm run auth:emails              # dry run
//   SUPABASE_ACCESS_TOKEN=<personal access token> npm run auth:emails -- --apply
// SBP is accepted in place of SUPABASE_ACCESS_TOKEN, and SB_REF picks another
// project, as in apply-supabase.mjs. Never prints the token.
//
// The default is a dry run: it reads the live config and lists which keys this
// script owns differ from the repo. --apply PATCHes only those keys, reads the
// config back, and exits non-zero unless every owned key now matches.
//
// The SMTP password (a Resend API key) is a secret. It is not in this repo, is
// never sent, and stays whatever is set in the dashboard. That relies on PATCH
// leaving omitted fields alone: the Management API's OpenAPI spec makes every
// field of the PATCH body (UpdateAuthConfigBody) optional, and Supabase's
// documented examples send only a few fields, but neither says outright that
// omitted fields are kept — hence the loud note before every PATCH. For the
// same reason SMTP settings are only written to a project already on Resend.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_TYPES = [
  'confirmation',
  'recovery',
  'invite',
  'magic_link',
  'email_change',
  'reauthentication',
];

// Everything custom SMTP needs except the password, as set under
// Authentication → SMTP. Types follow UpdateAuthConfigBody in the OpenAPI spec
// (https://api.supabase.com/api/v1-json): smtp_port is a string there, and
// smtp_max_frequency an integer — the dashboard's minimum interval per user.
export const SMTP_SETTINGS = Object.freeze({
  smtp_admin_email: 'no-reply@caaciorg.com',
  smtp_host: 'smtp.resend.com',
  smtp_port: '465',
  smtp_user: 'resend',
  smtp_sender_name: 'CAACI',
  smtp_max_frequency: 60,
});

const TEMPLATES_DIR = new URL('./supabase/templates/', import.meta.url);
const API = 'https://api.supabase.com/v1';

export async function loadTemplates(dir = TEMPLATES_DIR) {
  const subjects = JSON.parse(await readFile(new URL('subjects.json', dir), 'utf8'));
  const contents = {};
  for (const type of TEMPLATE_TYPES) {
    contents[type] = await readFile(new URL(`${type}.html`, dir), 'utf8');
  }
  return { subjects, contents };
}

// The full set of auth-config keys this script owns, with the values the repo
// says they should have. Key names follow the Management API:
// mailer_subjects_<type> and mailer_templates_<type>_content.
// Templates are sent with LF line endings, so what reaches Supabase does not
// depend on how git checked the files out.
export function buildAuthPatch({ subjects, contents }) {
  const body = {};
  for (const type of TEMPLATE_TYPES) {
    body[`mailer_subjects_${type}`] = checkText(subjects[type], `subject for ${type}`);
    // CRLF and lone CR both become LF — the same line ends the diff ignores.
    const html = checkText(contents[type], `${type}.html`).replace(/\r\n?/g, '\n');
    for (const name of REQUIRED_VARIABLES[type]) {
      if (!new RegExp(`\\{\\{\\s*\\.${name}\\s*\\}\\}`).test(html)) {
        throw new Error(`${type}.html has no {{ .${name} }}`);
      }
    }
    body[`mailer_templates_${type}_content`] = html;
  }
  return { ...body, ...SMTP_SETTINGS };
}

// The variable each flow cannot work without: an email with no link or code in
// it arrives, and nobody can act on it. Checked here so one is never pushed.
const REQUIRED_VARIABLES = {
  confirmation: ['ConfirmationURL'],
  recovery: ['ConfirmationURL'],
  invite: ['ConfirmationURL'],
  magic_link: ['ConfirmationURL'],
  email_change: ['ConfirmationURL', 'NewEmail'],
  reauthentication: ['Token'],
};

// A byte-order mark would go out as an invisible character at the top of the
// email or subject, and an empty value is never what was meant.
function checkText(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is missing`);
  if (value.startsWith('\uFEFF')) {
    throw new Error(`${label} starts with a byte-order mark — save it as UTF-8 without one`);
  }
  if (!value.trim()) throw new Error(`${label} is empty`);
  return value;
}

// Line endings and trailing whitespace are not drift: git on Windows and the
// dashboard editor both rewrite them. Values compare as text, so a port that
// ever reads back as a number still matches.
export function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\s+$/, '');
}

// [{ key, summary }] for every owned key whose live value differs. Summaries
// are one line: short values are shown, HTML is described, never dumped.
export function diffAuthConfig(desired, live) {
  const drift = [];
  for (const [key, want] of Object.entries(desired)) {
    const repo = normalizeValue(want);
    const current = normalizeValue(live?.[key]);
    if (repo !== current) drift.push({ key, summary: summarize(current, repo) });
  }
  return drift;
}

function summarize(live, repo) {
  if (!live) return 'not set on the project';
  const short = (s) => !s.includes('\n') && s.length <= 80;
  if (short(live) && short(repo))
    return `live ${JSON.stringify(live)} → repo ${JSON.stringify(repo)}`;
  const a = live.split('\n');
  const b = repo.split('\n');
  let line = 0;
  while (line < a.length && line < b.length && a[line] === b[line]) line++;
  return `live ${a.length} lines / ${live.length} chars, repo ${b.length} lines / ${repo.length} chars, first difference on line ${line + 1}`;
}

// Replaces every occurrence of the token, so nothing printed can carry it.
function scrub(text, token) {
  return token ? String(text).split(token).join('[token]') : String(text);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let apply = false;
  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
    } else {
      // A typo such as --aply must not quietly run as a dry run.
      console.error(`✗ unknown option: ${arg}. Usage: npm run auth:emails [-- --apply]`);
      return 1;
    }
  }
  const token = env.SUPABASE_ACCESS_TOKEN || env.SBP;
  if (!token) {
    console.error('Missing SUPABASE_ACCESS_TOKEN (a Supabase personal access token). Run:');
    console.error('  SUPABASE_ACCESS_TOKEN=sbp_… npm run auth:emails [-- --apply]');
    return 1;
  }
  // Printable ASCII only. Anything else — a pasted newline, a space, a NUL —
  // makes Node's header validation throw with the whole token in its message.
  if (!/^[!-~]+$/.test(token)) {
    console.error(
      'SUPABASE_ACCESS_TOKEN contains characters an HTTP header cannot carry ' +
        '(a pasted newline or space?). Copy the token again.',
    );
    return 1;
  }
  const ref = env.SB_REF || 'wslzeqhipvibeflmxznh';
  const url = `${API}/projects/${ref}/config/auth`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  // Error bodies are printed for diagnosis. Scrubbed before truncating, so a
  // token echoed across the cut-off cannot leave a fragment behind.
  const failed = async (what, res) => {
    const text = scrub(await res.text(), token).slice(0, 400);
    console.error(`✗ ${what}: HTTP ${res.status} ${text}`);
  };
  const readConfig = async () => {
    const res = await fetch(url, { method: 'GET', headers });
    if (res.ok) return res.json();
    await failed(`GET ${url}`, res);
    return null;
  };

  const desired = buildAuthPatch(await loadTemplates());
  const owned = Object.keys(desired).length;
  console.log(`Project ${ref}: comparing ${owned} auth email settings with supabase/templates/…`);

  const live = await readConfig();
  if (!live) return 1;
  const drift = diffAuthConfig(desired, live);
  if (!drift.length) {
    console.log('✓ Live templates, subjects and SMTP settings match the repo. Nothing to do.');
    return 0;
  }
  console.log(`\n${drift.length} setting(s) differ:`);
  for (const d of drift) console.log(`  ${d.key}: ${d.summary}`);

  if (!apply) {
    console.log('\nDry run — nothing was changed. To push these: npm run auth:emails -- --apply');
    return 0;
  }

  // The password is never sent, so SMTP settings are only safe to write onto a
  // project that already sends through Resend. Anywhere else — no custom SMTP,
  // or another provider — Resend's host and user would be paired with a
  // password that is not a Resend key, and every auth email would fail.
  let send = drift;
  const liveHost = normalizeValue(live.smtp_host);
  const smtpRefused =
    drift.some((d) => d.key.startsWith('smtp_')) && liveHost !== SMTP_SETTINGS.smtp_host;
  if (smtpRefused) {
    console.error(
      `\n✗ Not writing SMTP settings: this project's SMTP host is ` +
        `${liveHost ? JSON.stringify(liveHost) : 'not set'}, not ${SMTP_SETTINGS.smtp_host}, ` +
        'and this script never sends a password. Switch SMTP to Resend (with the Resend API ' +
        'key) under Authentication → SMTP in the dashboard, then rerun.',
    );
    send = drift.filter((d) => !d.key.startsWith('smtp_'));
    if (!send.length) return 1;
    console.error('Applying the template and subject changes only.');
  }

  const patch = Object.fromEntries(send.map((d) => [d.key, desired[d.key]]));
  console.log(
    `\n⚠ PATCHing ${send.length} setting(s). smtp_pass is NOT sent — the SMTP password stays ` +
      'as set in the dashboard. If auth emails stop arriving afterwards, re-enter it there.',
  );
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(patch) });
  if (!res.ok) {
    await failed(`PATCH ${url}`, res);
    return 1;
  }

  const after = await readConfig();
  if (!after) return 1;
  const remaining = diffAuthConfig(desired, after).filter(
    (d) => !(smtpRefused && d.key.startsWith('smtp_')),
  );
  if (remaining.length) {
    console.error(`✗ PATCH accepted, but ${remaining.length} setting(s) still differ:`);
    for (const d of remaining) console.error(`  ${d.key}: ${d.summary}`);
    return 1;
  }
  if (smtpRefused) {
    console.error('✗ Templates and subjects applied; SMTP settings left unchanged (see above).');
    return 1;
  }
  console.log(`✓ Applied. All ${owned} owned settings now match the repo.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      // A thrown error can quote a request header, so this path is scrubbed too.
      console.error(
        `✗ ${scrub(err.message, process.env.SUPABASE_ACCESS_TOKEN || process.env.SBP)}`,
      );
      process.exitCode = 1;
    },
  );
}
