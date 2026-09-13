// Event registration forms: the shape of an event's questions
// (events.registration_questions, 0018) and of a registrant's answers
// (event_registrations.answers). Pure — no fetch, no env — so the public API,
// the admin API and the emails all apply exactly the same rules.
//
// Question (array order = display order):
//   { id, type: 'single' | 'multi' | 'text' | 'textarea', label_en, label_zh,
//     required, options?: [{ id, label_en, label_zh }], other?: boolean }
// Answer, by question type (absent = unanswered):
//   text / textarea → the trimmed string
//   single          → { option: '<optionId>' } or { other: '<typed text>' }
//   multi           → { options: ['<optionId>', …], other?: '<typed text>' }
// Picking Other counts as an answer even with nothing typed, as the Mid-Autumn
// form did: `other` is present, possibly ''.

const ID_RE = /^[a-z0-9_]{1,40}$/;
const TYPES = new Set(['single', 'multi', 'text', 'textarea']);
const MAX_QUESTIONS = 30;
const MAX_OPTIONS = 30;
const MAX_LABEL = 200;
const MAX_TEXT = { text: 500, textarea: 2000 };
const MAX_OTHER = 200;

// '__proto__' matches the pattern but cannot be an own key of a plain object,
// so an answer or a count stored under it would silently vanish.
const validId = (id) => typeof id === 'string' && ID_RE.test(id) && id !== '__proto__';
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isChoice = (type) => type === 'single' || type === 'multi';

// Both labels, trimmed, 1–200 characters; null when either is not.
function labels(raw) {
  const en = typeof raw.label_en === 'string' ? raw.label_en.trim() : '';
  const zh = typeof raw.label_zh === 'string' ? raw.label_zh.trim() : '';
  if (!en || !zh || en.length > MAX_LABEL || zh.length > MAX_LABEL) return null;
  return { label_en: en, label_zh: zh };
}

// → { questions } normalized (unknown keys dropped), or { error } for the admin.
export function validateQuestions(raw) {
  if (!Array.isArray(raw)) return { error: 'Registration questions must be a list.' };
  if (raw.length > MAX_QUESTIONS)
    return { error: `An event can have at most ${MAX_QUESTIONS} questions.` };
  const ids = new Set();
  const questions = [];
  for (const [i, q] of raw.entries()) {
    const n = `Question ${i + 1}`;
    if (!isObject(q)) return { error: `${n} is invalid.` };
    if (!validId(q.id))
      return { error: `${n} has an invalid id (a–z, 0–9 and _, up to 40 characters).` };
    if (ids.has(q.id)) return { error: `${n} repeats the id "${q.id}".` };
    ids.add(q.id);
    if (!TYPES.has(q.type)) return { error: `${n} has an unknown type.` };
    const text = labels(q);
    if (!text)
      return {
        error: `${n} needs a label in both English and Chinese (up to ${MAX_LABEL} characters).`,
      };
    const out = { id: q.id, type: q.type, ...text, required: q.required === true };

    if (isChoice(q.type)) {
      const options = q.options;
      if (!Array.isArray(options) || options.length < 1 || options.length > MAX_OPTIONS)
        return { error: `${n} needs 1 to ${MAX_OPTIONS} options.` };
      const optionIds = new Set();
      out.options = [];
      for (const [j, o] of options.entries()) {
        const m = `Option ${j + 1} of question ${i + 1}`;
        if (!isObject(o)) return { error: `${m} is invalid.` };
        // 'other' is reserved: the registrations summary counts Other answers under it.
        if (!validId(o.id) || o.id === 'other')
          return {
            error: `${m} has an invalid id (a–z, 0–9 and _, up to 40 characters; not "other").`,
          };
        if (optionIds.has(o.id)) return { error: `${m} repeats the id "${o.id}".` };
        optionIds.add(o.id);
        const optionText = labels(o);
        if (!optionText)
          return {
            error: `${m} needs a label in both English and Chinese (up to ${MAX_LABEL} characters).`,
          };
        out.options.push({ id: o.id, ...optionText });
      }
      out.other = q.other === true;
    }
    questions.push(out);
  }
  return { questions };
}

// → { answers } normalized (answers to unknown questions dropped), or { error }
// naming the question in English for the registrant.
export function validateAnswers(questions, raw) {
  if (raw !== undefined && raw !== null && !isObject(raw)) return { error: 'Invalid answers.' };
  const given = raw ?? {};
  const answers = {};
  for (const q of questions) {
    const invalid = { error: `Invalid answer for: ${q.label_en}` };
    const value = Object.hasOwn(given, q.id) ? given[q.id] : undefined;
    let answer; // undefined = unanswered

    if (!isChoice(q.type)) {
      if (value !== undefined && value !== null) {
        if (typeof value !== 'string') return invalid;
        const s = value.trim();
        if (s.length > (MAX_TEXT[q.type] ?? MAX_TEXT.text)) return invalid;
        if (s) answer = s;
      }
    } else if (value !== undefined && value !== null) {
      if (!isObject(value)) return invalid;
      const known = new Set(q.options.map((o) => o.id));

      let other;
      if (value.other !== undefined && value.other !== null) {
        if (!q.other || typeof value.other !== 'string') return invalid;
        other = value.other.trim();
        if (other.length > MAX_OTHER) return invalid;
      }

      if (q.type === 'single') {
        const option = value.option ?? '';
        if (option !== '') {
          // One choice: a known option, or Other, never both.
          if (typeof option !== 'string' || !known.has(option) || other !== undefined)
            return invalid;
          answer = { option };
        } else if (other !== undefined) {
          answer = { other };
        }
      } else {
        const picked = value.options ?? [];
        if (!Array.isArray(picked) || picked.some((id) => typeof id !== 'string' || !known.has(id)))
          return invalid;
        // In the question's own order, each option once.
        const options = q.options.map((o) => o.id).filter((id) => picked.includes(id));
        if (options.length || other !== undefined)
          answer = { options, ...(other !== undefined ? { other } : {}) };
      }
    }

    if (answer === undefined) {
      if (q.required) return { error: `Answer the question: ${q.label_en}` };
      continue;
    }
    answers[q.id] = answer;
  }
  return { answers };
}

// The event's free gift, or null when it offers none (either name missing).
// Its deadline is the event's perk_deadline, else its start.
export function perkOf(event) {
  const item_en = String(event?.perk_item_en ?? '').trim();
  const item_zh = String(event?.perk_item_zh ?? '').trim();
  if (!item_en || !item_zh) return null;
  return { item_en, item_zh, deadline: event.perk_deadline ?? event.starts_at ?? null };
}

// Registration stays open until the event ends (or starts, with no end), inclusive.
export function registrationOpen(event, now = Date.now()) {
  return Number(now) <= Date.parse(event?.ends_at ?? event?.starts_at);
}

// The option labels a choice answer picked, in `lang` ('zh' or 'en'). Other
// yields the word "其他" / "Other", never the typed text; option ids the
// question no longer has are skipped.
export function choiceAnswerLabels(question, answer, lang) {
  if (!isObject(answer) || !Array.isArray(question?.options)) return [];
  const key = lang === 'zh' ? 'label_zh' : 'label_en';
  const picked = new Set([
    ...(Array.isArray(answer.options) ? answer.options : []),
    ...(typeof answer.option === 'string' ? [answer.option] : []),
  ]);
  const out = question.options.filter((o) => picked.has(o.id)).map((o) => o[key]);
  if (typeof answer.other === 'string') out.push(lang === 'zh' ? '其他' : 'Other');
  return out;
}
