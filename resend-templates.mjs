// resend-templates.mjs — copies the CAACI email layouts into Resend Templates.
//
// The layouts live in functions/api/_event-emails.js (templateVariables):
//   event-registration-confirmation — what /api/event-register sends a registrant
//   event-announcement              — admin Compose News → Event announcement
//   event-reminder                  — admin Compose News → Event reminder
//   event-thank-you                 — admin Compose News → Event thank-you
//   news-general                    — admin Compose News → General announcement
//   membership-renewal-reminder     — admin Compose News → Membership renewal reminder
// NOTHING ON THE SITE READS THESE COPIES. The site renders every email from
// _event-emails.js itself and sends plain HTML; the Resend copies exist so the
// layouts can be previewed, or sent by hand, from the Resend dashboard. Changing
// a template in Resend changes nothing the site sends; rerun this to put the
// repo's version back.
//
// Usage:
//   RESEND_API_KEY=re_… npm run resend:templates              # dry run
//   RESEND_API_KEY=re_… npm run resend:templates -- --apply
// Needs a full-access API key (a sending-only key cannot read or write
// templates). Never prints the key.
//
// The default is a dry run: it reads each template by its alias and lists which
// would be created, updated (and which fields differ) or only published.
// --apply creates (POST /templates) or updates (PATCH /templates/{id}) each
// one that differs, publishes it (POST /templates/{id}/publish), reads it back
// and exits non-zero unless it now matches the repo and is published.
// Endpoints and fields as documented at
// https://resend.com/docs/api-reference/templates/ — create, retrieve (by id or
// alias), update, publish.
import { fileURLToPath } from 'node:url';
import { templateVariables } from './functions/api/_event-emails.js';

const API = 'https://api.resend.com';

// Resend refuses these variable names; UNSUBSCRIBE_URL is kept off too so a
// template never looks like it carries an unsubscribe link it does not.
export const RESERVED_KEYS = [
  'FIRST_NAME',
  'LAST_NAME',
  'EMAIL',
  'UNSUBSCRIBE_URL',
  'RESEND_UNSUBSCRIBE_URL',
  'CONTACT',
  'THIS',
];
const KEY_RE = /^[A-Z][A-Z0-9_]{0,49}$/;

// Every variable a valid key, every placeholder declared, every declared
// variable used, at most 50. Throws on the first problem.
export function checkTemplates(templates) {
  for (const t of templates) {
    if (!t.alias || !t.name || !t.subject || !t.html) throw new Error(`${t.alias}: incomplete`);
    const keys = t.variables.map((v) => v.key);
    if (keys.length > 50) throw new Error(`${t.alias}: more than 50 variables`);
    for (const key of keys) {
      if (!KEY_RE.test(key)) throw new Error(`${t.alias}: invalid variable name ${key}`);
      if (RESERVED_KEYS.includes(key)) throw new Error(`${t.alias}: reserved variable name ${key}`);
    }
    const used = new Set(
      [...`${t.subject}\n${t.html}`.matchAll(/\{\{\{\s*([^}\s]*)\s*\}\}\}/g)].map((m) => m[1]),
    );
    for (const key of used)
      if (!keys.includes(key)) throw new Error(`${t.alias}: {{{${key}}}} is not declared`);
    for (const key of keys)
      if (!used.has(key)) throw new Error(`${t.alias}: ${key} is declared but never used`);
  }
  return templates;
}

// What is sent for one template: LF line endings, so what reaches Resend does
// not depend on how git checked the repo out.
export function templateBody(t) {
  return {
    name: t.name,
    alias: t.alias,
    subject: t.subject,
    html: t.html.replace(/\r\n?/g, '\n'),
    variables: t.variables.map(({ key, type }) => ({ key, type })),
  };
}

// Line endings and trailing whitespace are not drift.
const normalize = (s) =>
  String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\s+$/, '');
// Variables compare by key, type and fallback (none, null and '' alike),
// ignoring the ids and timestamps Resend adds.
const variableList = (vars) =>
  (Array.isArray(vars) ? vars : [])
    .map((v) => `${v.key}:${v.type}:${v.fallback_value ?? ''}`)
    .sort()
    .join('\n');

// { changed: ['subject', …], unpublished } for the repo body against the live template.
export function diffTemplate(desired, live) {
  const changed = [];
  for (const field of ['name', 'subject', 'html'])
    if (normalize(desired[field]) !== normalize(live?.[field])) changed.push(field);
  if (variableList(desired.variables) !== variableList(live?.variables)) changed.push('variables');
  const unpublished = live?.status !== 'published' || live?.has_unpublished_versions === true;
  return { changed, unpublished };
}

// Replaces every occurrence of the key, so nothing printed can carry it.
function scrub(text, key) {
  return key ? String(text).split(key).join('[key]') : String(text);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `pause` runs before every request after the first: Resend's default rate
// limit is a few requests per second per team.
export async function main(argv = process.argv.slice(2), env = process.env, { pause } = {}) {
  let apply = false;
  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
    } else {
      // A typo such as --aply must not quietly run as a dry run.
      console.error(`✗ unknown option: ${arg}. Usage: npm run resend:templates [-- --apply]`);
      return 1;
    }
  }
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.error('Missing RESEND_API_KEY (a full-access Resend API key). Run:');
    console.error('  RESEND_API_KEY=re_… npm run resend:templates [-- --apply]');
    return 1;
  }
  // Printable ASCII only. Anything else — a pasted newline, a space — makes
  // Node's header validation throw with the whole key in its message.
  if (!/^[!-~]+$/.test(key)) {
    console.error(
      'RESEND_API_KEY contains characters an HTTP header cannot carry ' +
        '(a pasted newline or space?). Copy the key again.',
    );
    return 1;
  }

  const templates = checkTemplates(templateVariables).map(templateBody);
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const delay = pause ?? (() => wait(600));
  let requests = 0;
  const call = async (method, path, body) => {
    if (requests++) await delay();
    return fetch(`${API}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  };
  // Error bodies are printed for diagnosis, scrubbed before truncating.
  const failed = async (what, res) => {
    const text = scrub(await res.text(), key).slice(0, 400);
    console.error(`✗ ${what}: HTTP ${res.status} ${text}`);
  };
  // The live template, null when the alias does not exist, false on an error.
  const read = async (alias) => {
    const path = `/templates/${encodeURIComponent(alias)}`;
    const res = await call('GET', path);
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    await failed(`GET ${path}`, res);
    return false;
  };

  console.log(
    `Comparing ${templates.length} Resend templates with functions/api/_event-emails.js…`,
  );
  const plans = [];
  for (const t of templates) {
    const live = await read(t.alias);
    if (live === false) return 1;
    const diff = live ? diffTemplate(t, live) : null;
    const action = !live
      ? 'create'
      : diff.changed.length
        ? 'update'
        : diff.unpublished
          ? 'publish'
          : null;
    plans.push({ t, live, action });
    const what = {
      create: 'not in Resend — would be created and published',
      update: `differs (${diff?.changed.join(', ')}) — would be updated and published`,
      publish: 'matches, but has unpublished changes — would be published',
      [null]: 'up to date and published',
    }[action];
    console.log(`  ${t.alias}: ${what}`);
  }

  const todo = plans.filter((p) => p.action);
  if (!todo.length) {
    console.log('✓ Every template matches the repo. Nothing to do.');
    return 0;
  }
  if (!apply) {
    console.log(
      `\nDry run — nothing was changed. --apply would write ${todo.length} template(s): ` +
        todo.map((p) => p.t.alias).join(', '),
    );
    console.log('To write them: npm run resend:templates -- --apply');
    return 0;
  }

  let ok = true;
  for (const { t, live, action } of todo) {
    // From the first write on, a network error does not mean nothing happened.
    try {
      let id = live?.id;
      if (action === 'create') {
        const res = await call('POST', '/templates', t);
        if (!res.ok) {
          await failed(`POST /templates (${t.alias})`, res);
          ok = false;
          continue;
        }
        id = (await res.json())?.id;
      } else if (action === 'update') {
        const res = await call('PATCH', `/templates/${encodeURIComponent(id)}`, t);
        if (!res.ok) {
          await failed(`PATCH /templates/${id} (${t.alias})`, res);
          ok = false;
          continue;
        }
      }
      const target = encodeURIComponent(id || t.alias);
      const published = await call('POST', `/templates/${target}/publish`);
      if (!published.ok) {
        await failed(`POST /templates/${target}/publish (${t.alias})`, published);
        ok = false;
        continue;
      }
      const after = await read(t.alias);
      if (!after) {
        if (after === null) console.error(`✗ ${t.alias}: not found when read back`);
        ok = false;
        continue;
      }
      const diff = diffTemplate(t, after);
      if (diff.changed.length || diff.unpublished) {
        console.error(
          `✗ ${t.alias}: written, but reads back ${diff.changed.length ? `with different ${diff.changed.join(', ')}` : 'unpublished'}`,
        );
        ok = false;
        continue;
      }
      console.log(
        `✓ ${t.alias}: ${action === 'publish' ? 'published' : `${action}d and published`}`,
      );
    } catch (err) {
      console.error(`✗ ${t.alias}: ${scrub(err.message, key)}`);
      console.error(
        'The write may already have been applied — rerun the dry run (npm run resend:templates) to see the live state.',
      );
      ok = false;
    }
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      // A thrown error can quote a request header, so this path is scrubbed too.
      console.error(`✗ ${scrub(err.message, process.env.RESEND_API_KEY)}`);
      process.exitCode = 1;
    },
  );
}
