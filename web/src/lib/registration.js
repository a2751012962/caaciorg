// The rules behind the event registration page (/events/<slug>/register/),
// lifted out of the component so they can be read and tested without a DOM:
// which event the address names, which free-gift step a registration is at,
// the answers in the API's shape, the three-way volunteer field, and the
// Chinese wording for the refusals /api/event-register sends in English.
//
// Plain JS on purpose: test/web-event-register-rules.test.js imports this file
// directly with node --test (CI is Node 20 and cannot load TypeScript).

/**
 * Which event the page is for: the slug in `/events/<slug>/register/` (the
 * _redirects rewrite keeps that path in the address bar, with or without the
 * /zh/ prefix), else `?event=<slug>`. '' when neither names one.
 * @param {string} pathname
 * @param {string} [search]
 * @returns {string}
 */
export function eventSlugFrom(pathname, search = '') {
  const m = /^\/(?:zh\/)?events\/([^/]+)\/register\/?$/i.exec(pathname || '');
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return ''; // a malformed escape names no event
    }
  }
  try {
    return (new URLSearchParams(search || '').get('event') || '').trim();
  } catch {
    return '';
  }
}

/**
 * Which free-gift step a registration shows. The server decides who really
 * gets one; this mirrors its rule (registered, and holding an account, by the
 * deadline) only to pick the wording. A time we do not know never closes it.
 * @param {{ deadline?: string|null, registeredAt?: string|null, signedIn?: boolean,
 *           accountCreatedAt?: string|null, now?: number }} input
 * @returns {'counted'|'signup'|'closed'}
 */
export function perkStep({ deadline, registeredAt, signedIn, accountCreatedAt, now = Date.now() }) {
  const end = deadline ? new Date(deadline).getTime() : NaN;
  const after = (time) => time > end; // false whenever either side is NaN
  if (after(new Date(registeredAt).getTime())) return 'closed';
  if (signedIn) return after(new Date(accountCreatedAt).getTime()) ? 'closed' : 'counted';
  return after(now) ? 'closed' : 'signup';
}

/** The id the page gives a question's field, so an error can focus it. */
export const questionFieldId = (q) => `ev-q-${q.id}`;
/** The id of a choice question's "Other" text box. */
export const otherFieldId = (q) => `ev-q-${q.id}-other-text`;

/** A question's (or an option's) label in the current language. */
export const questionLabel = (item, lang) =>
  lang === 'zh' ? item.label_zh || item.label_en : item.label_en;

/**
 * The answers in the API's shape — a text answer as a string, a single choice
 * as { option } or { other }, a multiple choice as { options, other? }, and an
 * unanswered question left out — or the first problem as { error, field }.
 * The API checks all of it again; asking here saves a round trip on a phone.
 *
 * `state` is the page's plain answer state, one entry per question id:
 * a string for text/textarea, and `{ picked: string[], other: string|null }`
 * for a choice question (`other: null` means the Other box is not ticked).
 * `field` is the id of the input to focus, never an element.
 *
 * @param {Array<any>} questions
 * @param {Record<string, any>} state
 * @param {'en'|'zh'} lang
 * @returns {{ answers: Record<string, any> } | { error: string, field: string }}
 */
export function readAnswers(questions, state, lang) {
  const answers = {};
  for (const q of questions || []) {
    const label = questionLabel(q, lang);
    const unanswered = (field) => ({
      error: lang === 'zh' ? `请回答：${label}` : `Answer the question: ${q.label_en}`,
      field,
    });
    if (q.type === 'text' || q.type === 'textarea') {
      const value = String(state?.[q.id] ?? '').trim();
      if (value) answers[q.id] = value;
      else if (q.required) return unanswered(questionFieldId(q));
      continue;
    }
    if (q.type !== 'single' && q.type !== 'multi') continue;
    const entry = state?.[q.id] || {};
    const picked = Array.isArray(entry.picked) ? entry.picked.filter(Boolean) : [];
    let other = null;
    if (entry.other != null) {
      other = String(entry.other).trim();
      if (!other)
        return {
          error:
            lang === 'zh' ? `请填写“其他”的内容：${label}` : `Fill in “Other” for: ${q.label_en}`,
          field: otherFieldId(q),
        };
    }
    if (q.type === 'single') {
      if (other !== null) answers[q.id] = { other };
      else if (picked.length) answers[q.id] = { option: picked[0] };
    } else if (picked.length || other !== null) {
      answers[q.id] = other === null ? { options: picked } : { options: picked, other };
    }
    if (q.required && !answers[q.id]) return unanswered(questionFieldId(q));
  }
  return { answers };
}

/**
 * The `volunteer` key of the POST body, as three cases and nothing else:
 * `{ volunteer: { name, phone } }` when the box is ticked; `{ volunteer: false }`
 * only when the GET pre-filled the box and it is now un-ticked, which is how
 * someone withdraws; and no key at all otherwise, so a plain registration never
 * touches the volunteer list.
 * @param {boolean} prefilled
 * @param {boolean} checked
 * @param {string} name
 * @param {string} phone
 * @returns {{ volunteer?: { name: string, phone: string } | false }}
 */
export function volunteerBody(prefilled, checked, name, phone) {
  if (checked)
    return { volunteer: { name: String(name || '').trim(), phone: String(phone || '').trim() } };
  if (prefilled) return { volunteer: false };
  return {};
}

// /api/event-register refuses with English sentences; the ones a person can act
// on get a Chinese counterpart on /zh/ (the same table the volunteer dialog
// keeps in web/src/components/Modals.tsx).
export const REGISTER_ERRORS_ZH = {
  'Enter a valid email address.': '请输入有效的电子邮箱。',
  'Enter your name to volunteer.': '请填写志愿者姓名。',
  'Event not found.': '该活动未开放报名。',
  'Registration for this event has closed.': '本活动报名已截止。',
  'event required': '缺少活动信息，请检查链接。',
  'invalid JSON': '提交内容有误，请重试。',
};

/**
 * The Chinese wording for a server refusal, or '' when there is none and the
 * page should fall back to its own generic sentence.
 * @param {string|undefined|null} msg
 * @returns {string}
 */
export function zhError(msg) {
  return (msg && REGISTER_ERRORS_ZH[msg]) || '';
}
