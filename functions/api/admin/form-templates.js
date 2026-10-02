// /api/admin/form-templates  (admin only) — named sets of questions an admin
// copies into an event's form, or saves out of one (form_templates, 0035).
//   GET    ?kind=volunteer|registration — the templates of that kind (all when
//          no kind), by name; each with its questions.
//   PUT    { kind, name, questions, is_default? } — create one.
//   POST   { id, name?, questions?, is_default? } — patch one. Making it the
//          default first clears the kind's current default (one per kind: the
//          partial unique index would refuse two).
//   DELETE body/query { id } — remove one. The kind's default cannot be
//          deleted: the volunteer default is what the dialog asks, so another
//          template has to be made the default first.
// Copy, never reference: an event holds its own copy of the questions, so
// nothing here touches events. The questions are checked by validateQuestions,
// the same rule the events they are copied into apply.
// Every request is gated by requireAdmin.
import { json, bad, sb, requireAdmin } from '../_lib.js';
import { validateQuestions } from '../_event-form.js';

const KINDS = new Set(['volunteer', 'registration']);
const COLUMNS = 'id,kind,name,questions,is_default,created_at,updated_at';
const MAX_ROWS = 200;
const MAX_NAME = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The template name as stored: trimmed, 1–80 characters. undefined when not
// sent, { error } when unusable.
function nameOf(value) {
  if (value === undefined) return undefined;
  const name = String(value ?? '').trim();
  if (!name) return { error: 'Give the template a name.' };
  if (name.length > MAX_NAME)
    return { error: `A template name is at most ${MAX_NAME} characters.` };
  return name;
}

async function idFrom(request) {
  let id = new URL(request.url).searchParams.get('id') || '';
  if (!id) {
    try {
      id = (await request.json()).id || '';
    } catch {
      /* no body */
    }
  }
  return String(id);
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const kind = (new URL(request.url).searchParams.get('kind') || '').trim();
  if (kind && !KINDS.has(kind)) return bad('Unknown template kind.');
  try {
    const { rows } = await sb(env).select('form_templates', {
      columns: COLUMNS,
      filters: kind ? [`kind=eq.${kind}`] : [],
      order: 'name.asc',
      limit: MAX_ROWS,
    });
    return json({ rows });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPut({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  if (!b || typeof b !== 'object') return bad('invalid JSON');
  if (!KINDS.has(b.kind)) return bad('Unknown template kind.');
  const name = nameOf(b.name);
  if (name === undefined) return bad('Give the template a name.');
  if (name.error) return bad(name.error);
  const { questions, error } = validateQuestions(b.questions ?? []);
  if (error) return bad(error);
  const makeDefault = b.is_default === true;

  try {
    const DB = sb(env);
    if (makeDefault)
      await DB.update('form_templates', { kind: b.kind, is_default: true }, { is_default: false });
    const rows = await DB.insert('form_templates', {
      kind: b.kind,
      name,
      questions,
      is_default: makeDefault,
    });
    return json({ ok: true, template: rows[0] });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  if (!b || typeof b !== 'object') return bad('invalid JSON');
  const id = String(b.id || '');
  if (!id) return bad('Template id is required.');
  if (!UUID.test(id)) return bad('Template not found.', 404);

  const patch = {};
  const name = nameOf(b.name);
  if (name?.error) return bad(name.error);
  if (name !== undefined) patch.name = name;
  if (b.questions !== undefined) {
    const { questions, error } = validateQuestions(b.questions);
    if (error) return bad(error);
    patch.questions = questions;
  }
  // Only ever set: a kind's default is changed by naming another template,
  // never by switching this one off and leaving the kind with none.
  if (b.is_default !== undefined && b.is_default !== true)
    return bad('Make another template the default instead.');
  const makeDefault = b.is_default === true;
  if (!Object.keys(patch).length && !makeDefault) return bad('Nothing to update.');

  try {
    const DB = sb(env);
    const row = await DB.selectOne('form_templates', { id }, 'id,kind,is_default');
    if (!row) return bad('Template not found.', 404);
    if (makeDefault && !row.is_default) {
      await DB.update(
        'form_templates',
        { kind: row.kind, is_default: true },
        { is_default: false },
      );
      patch.is_default = true;
    }
    if (Object.keys(patch).length)
      await DB.update('form_templates', { id }, { ...patch, updated_at: new Date().toISOString() });
    const out = await DB.selectOne('form_templates', { id }, COLUMNS);
    return json({ ok: true, template: out });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const id = await idFrom(request);
  if (!id) return bad('Template id is required.');
  if (!UUID.test(id)) return bad('Template not found.', 404);
  try {
    const DB = sb(env);
    const row = await DB.selectOne('form_templates', { id }, 'id,is_default');
    if (!row) return bad('Template not found.', 404);
    if (row.is_default)
      return bad('This is the default template. Make another one the default first.');
    await DB.del('form_templates', { id });
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}
