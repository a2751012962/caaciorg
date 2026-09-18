// The Events and Volunteers tabs' pure rules, ported from src/caaci-admin.js:
// event times, the registration link, the question builder's state and
// validation (mirroring functions/api/_event-form.js validateQuestions, which
// has the last word), answers as text, and the two CSV exports.
import type { Lang } from '../../../../lib/lang';

type T = (en: string, zh: string) => string;

// ------------------------------------------------------------------ types

export type QuestionType = 'single' | 'multi' | 'text' | 'textarea' | 'number' | 'phone' | 'date';

export interface Option {
  id: string;
  label_en: string;
  label_zh: string;
}

/** A question as the API stores it. */
export interface Question {
  id: string;
  type: QuestionType;
  label_en: string;
  label_zh: string;
  required?: boolean;
  options?: Option[];
  other?: boolean;
  min?: number;
  max?: number;
}

/** A question in the editor: every field present, bounds kept as typed. */
export interface DraftQuestion {
  id: string;
  type: QuestionType;
  label_en: string;
  label_zh: string;
  required: boolean;
  options: Option[];
  other: boolean;
  min: string;
  max: string;
}

export interface AdminEvent {
  id: string;
  title: string;
  title_zh: string | null;
  slug: string | null;
  description: string | null;
  description_zh: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  image_url: string | null;
  published: boolean;
  perk_deadline: string | null;
  perk_item_zh: string | null;
  perk_item_en: string | null;
  registration_questions: Question[] | null;
  created_at?: string;
  registration_count?: number;
}

export interface Perk {
  item_en: string;
  item_zh: string;
  deadline: string;
}

export type ChoiceAnswer = { option?: string | null; options?: string[]; other?: string };
export type Answer = string | number | ChoiceAnswer | null | undefined;

export interface Registration {
  id: string;
  email: string;
  answers: Record<string, Answer>;
  created_at: string;
  updated_at?: string;
  member_id?: string | null;
  account: {
    id: string;
    created_at: string;
    status: string;
    tier_id: string | null;
    confirmed: boolean;
  } | null;
  perk_eligible: boolean;
}

export interface RegistrationsData {
  event: {
    id: string;
    slug: string | null;
    title: string;
    title_zh: string | null;
    starts_at: string;
    perk: Perk | null;
  };
  questions: Question[];
  rows: Registration[];
  summary: {
    total?: number;
    with_account?: number;
    perk_eligible?: number;
    choices?: Record<string, Record<string, number>>;
  };
}

export interface Volunteer {
  id: string;
  event_id: string | null;
  name: string | null;
  email: string;
  phone: string | null;
  message: string | null;
  source: string | null;
  member_id: string | null;
  created_at: string;
  updated_at?: string;
  event: { slug: string | null; title: string; title_zh: string | null; starts_at: string } | null;
  account: { id: string; status: string; tier_id: string | null } | null;
}

// ------------------------------------------------------------------ events

/** datetime-local wants local wall-clock time; toISOString is UTC — shift first. */
export const dtInput = (d: string | null | undefined) => {
  if (!d) return '';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '';
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
};
/** …and back: a datetime-local value parses as local time. Anything unparseable
 *  is passed through for the server to refuse. */
export const localToIso = (v: string) => {
  const d = new Date(v);
  return v && !isNaN(d.getTime()) ? d.toISOString() : v;
};
export const fmtWhen = (lang: Lang, e: Pick<AdminEvent, 'starts_at' | 'ends_at'>) => {
  const loc = lang === 'zh' ? 'zh-CN' : 'en-US';
  const txt = new Date(e.starts_at).toLocaleString(loc, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return e.ends_at
    ? `${txt} – ${new Date(e.ends_at).toLocaleTimeString(loc, { timeStyle: 'short' })}`
    : txt;
};

/** Open = published, has a slug, takes registrations, and has not ended (the
 *  API's registrationOpen rule, now <= ends_at ?? starts_at). */
export const registrationOpen = (e: AdminEvent) =>
  !!e.published &&
  !!e.slug &&
  Array.isArray(e.registration_questions) &&
  Date.now() <= Date.parse(e.ends_at ?? e.starts_at);
export const registrationUrl = (e: Pick<AdminEvent, 'slug'>) =>
  `${location.origin}/events/${encodeURIComponent(e.slug || '')}/register/`;

export const eventTitleIn = (lang: Lang, e: { title: string; title_zh?: string | null }) =>
  (lang === 'zh' && e.title_zh) || e.title;

// ------------------------------------------------------------------ questions

export const Q_TYPES: QuestionType[] = [
  'single',
  'multi',
  'text',
  'textarea',
  'number',
  'phone',
  'date',
];
export const CHOICE_TYPES = new Set<QuestionType>(['single', 'multi']);
export const MAX_QUESTIONS = 30;
export const MAX_OPTIONS = 30;
export const MAX_LABEL = 200;
const QUESTION_ID = /^[a-z0-9_]{1,40}$/;
// A number question's optional bounds: whole numbers no further than a billion
// from zero (the API's MAX_NUMBER).
const WHOLE_NUMBER = /^-?\d{1,10}$/;
const MAX_NUMBER = 1_000_000_000;
const boundOk = (v: string) =>
  v === '' || (WHOLE_NUMBER.test(v) && Math.abs(Number(v)) <= MAX_NUMBER);

export const typeName = (t: T): Record<QuestionType, string> => ({
  single: t('One choice', '单选'),
  multi: t('Several choices', '多选'),
  text: t('Short text', '简短文字'),
  textarea: t('Long text', '长文字'),
  number: t('Number', '数字'),
  phone: t('Phone number', '电话号码'),
  date: t('Date', '日期'),
});

/** `prefix` + 6 random [a-z0-9], not already in `taken`. Ids are minted once and
 *  never derived from a label, so stored answers keep matching. */
export function newId(prefix: string, taken: string[]) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    const rnd = crypto.getRandomValues(new Uint8Array(6));
    const id = prefix + [...rnd].map((b) => chars[b % chars.length]).join('');
    if (!taken.includes(id)) return id;
  }
}
export const blankOption = (q: Pick<DraftQuestion, 'options'>): Option => ({
  id: newId(
    'o_',
    q.options.map((o) => o.id),
  ),
  label_en: '',
  label_zh: '',
});
export function blankQuestion(qs: DraftQuestion[]): DraftQuestion {
  const q: DraftQuestion = {
    id: newId(
      'q_',
      qs.map((x) => x.id),
    ),
    type: 'single',
    label_en: '',
    label_zh: '',
    required: false,
    options: [],
    other: false,
    min: '',
    max: '',
  };
  q.options.push(blankOption(q));
  return q;
}

/** Editable copy of an event's registration_questions (null → none yet). */
export const questionState = (raw: unknown): DraftQuestion[] =>
  (Array.isArray(raw) ? (raw as Partial<Question>[]) : []).map((q) => ({
    id: String(q?.id ?? ''),
    type: Q_TYPES.includes(q?.type as QuestionType) ? (q.type as QuestionType) : 'text',
    label_en: String(q?.label_en ?? ''),
    label_zh: String(q?.label_zh ?? ''),
    required: !!q?.required,
    options: (Array.isArray(q?.options) ? q.options : []).map((o) => ({
      id: String(o?.id ?? ''),
      label_en: String(o?.label_en ?? ''),
      label_zh: String(o?.label_zh ?? ''),
    })),
    other: !!q?.other,
    min: q?.min == null ? '' : String(q.min),
    max: q?.max == null ? '' : String(q.max),
  }));

/** What the API stores: labels trimmed; options + `other` on choice questions
 *  only; min/max on number questions only, and only the ones set. */
export const questionsPayload = (qs: DraftQuestion[]): Question[] =>
  qs.map((q) => ({
    id: q.id,
    type: q.type,
    label_en: q.label_en.trim(),
    label_zh: q.label_zh.trim(),
    required: q.required,
    ...(CHOICE_TYPES.has(q.type)
      ? {
          options: q.options.map((o) => ({
            id: o.id,
            label_en: o.label_en.trim(),
            label_zh: o.label_zh.trim(),
          })),
          other: q.other,
        }
      : {}),
    ...(q.type === 'number' && q.min.trim() !== '' ? { min: Number(q.min.trim()) } : {}),
    ...(q.type === 'number' && q.max.trim() !== '' ? { max: Number(q.max.trim()) } : {}),
  }));

/** The first problem with the questions, for the admin; null when they look valid. */
export function questionsError(t: T, qs: DraftQuestion[]): string | null {
  if (qs.length > MAX_QUESTIONS)
    return t(`Use at most ${MAX_QUESTIONS} questions.`, `最多只能有 ${MAX_QUESTIONS} 个问题。`);
  const labelled = (x: { label_en: string; label_zh: string }) =>
    [x.label_en.trim(), x.label_zh.trim()].every((s) => s.length >= 1 && s.length <= MAX_LABEL);
  const ids = new Set<string>();
  for (const [i, q] of qs.entries()) {
    const n = i + 1;
    if (!QUESTION_ID.test(q.id) || ids.has(q.id))
      return t(
        `Question ${n} has an invalid id. Remove it and add it again.`,
        `问题 ${n} 的编号无效，请删除后重新添加。`,
      );
    ids.add(q.id);
    if (!labelled(q))
      return t(
        `Question ${n}: enter the question in both English and Chinese (up to ${MAX_LABEL} characters).`,
        `问题 ${n}：请用英文和中文填写问题（最多 ${MAX_LABEL} 个字符）。`,
      );
    if (q.type === 'number') {
      const min = q.min.trim();
      const max = q.max.trim();
      if (!boundOk(min) || !boundOk(max))
        return t(
          `Question ${n}: the smallest and largest allowed values must be whole numbers.`,
          `问题 ${n}：最小值和最大值必须是整数。`,
        );
      if (min !== '' && max !== '' && Number(min) > Number(max))
        return t(
          `Question ${n}: the smallest allowed value is above the largest.`,
          `问题 ${n}：最小值不能大于最大值。`,
        );
    }
    if (!CHOICE_TYPES.has(q.type)) continue;
    if (q.options.length < 1 || q.options.length > MAX_OPTIONS)
      return t(
        `Question ${n}: give it 1 to ${MAX_OPTIONS} options.`,
        `问题 ${n}：请设置 1 到 ${MAX_OPTIONS} 个选项。`,
      );
    const optionIds = new Set<string>();
    for (const [j, o] of q.options.entries()) {
      if (!QUESTION_ID.test(o.id) || optionIds.has(o.id))
        return t(
          `Question ${n}, option ${j + 1} has an invalid id. Remove it and add it again.`,
          `问题 ${n} 的选项 ${j + 1} 编号无效，请删除后重新添加。`,
        );
      optionIds.add(o.id);
      if (!labelled(o))
        return t(
          `Question ${n}, option ${j + 1}: enter the option in both English and Chinese (up to ${MAX_LABEL} characters).`,
          `问题 ${n} 的选项 ${j + 1}：请用英文和中文填写选项（最多 ${MAX_LABEL} 个字符）。`,
        );
    }
  }
  return null;
}

/** A copy of `list` with list[from] moved to `to` (unchanged when out of range). */
export function moved<X>(list: X[], from: number, to: number): X[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

// ------------------------------------------------------------------ answers

// The event is in Champaign and times are recorded to the second, so times are
// Chicago wall-clock "YYYY-MM-DD HH:mm:ss" whatever the admin's own zone — the
// same text on screen and in the CSV.
const chicagoParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
export const chicagoTime = (d: string | null | undefined) => {
  const x = d ? new Date(d) : null;
  if (!x || isNaN(x.getTime())) return '';
  const p = Object.fromEntries(chicagoParts.formatToParts(x).map((q) => [q.type, q.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

/** A question's or option's label in `inLang` (English when the Chinese is missing). */
export const labelIn = (x: { label_en?: string; label_zh?: string }, inLang: Lang) =>
  (inLang === 'zh' && x.label_zh) || x.label_en || '';

/** One registrant's answer as plain text ('' = unanswered). Choices show their
 *  option labels and a typed Other as "Other: <text>"; an option removed from
 *  the form since shows its stored id. */
export function answerText(q: Question, answer: Answer, inLang: Lang): string {
  if (answer == null) return '';
  if (!CHOICE_TYPES.has(q.type))
    return typeof answer === 'string' || typeof answer === 'number' ? String(answer) : '';
  if (typeof answer !== 'object') return '';
  const option = (id: string) => {
    const o = (q.options || []).find((x) => x.id === id);
    return o ? labelIn(o, inLang) : String(id);
  };
  let parts: string[] = [];
  if (q.type === 'multi') parts = (Array.isArray(answer.options) ? answer.options : []).map(option);
  else if (answer.option != null) parts = [option(answer.option)];
  if (answer.other) parts.push(`${inLang === 'zh' ? '其他：' : 'Other: '}${answer.other}`);
  return parts.join('; ');
}

// ------------------------------------------------------------------ CSV

const yesNo = (v: boolean | undefined) => (v === true ? 'yes' : v === false ? 'no' : '');
// RFC 4180 quoting; text that starts like a spreadsheet formula gets a leading '.
const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvText = (lines: unknown[][]) =>
  `﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** The registrations CSV: English labels, `#` = position in registration order
 *  (kept when only eligible rows are exported). UTF-8 BOM, CRLF. */
export function registrationsCsv(
  { event, questions = [], rows = [] }: Pick<RegistrationsData, 'event' | 'questions' | 'rows'>,
  { eligibleOnly = false } = {},
) {
  const perk = event?.perk || null;
  const lines: unknown[][] = [
    [
      '#',
      'registered_at (Chicago)',
      'email',
      ...questions.map((q) => q.label_en),
      'has_account',
      'account_confirmed',
      'account_created_at (Chicago)',
      ...(perk ? [`gift_eligible (${perk.item_en})`] : []),
    ],
  ];
  rows.forEach((r, i) => {
    if (eligibleOnly && !r.perk_eligible) return;
    lines.push([
      i + 1,
      chicagoTime(r.created_at),
      r.email,
      ...questions.map((q) => answerText(q, r.answers?.[q.id], 'en')),
      yesNo(!!r.account),
      r.account ? yesNo(!!r.account.confirmed) : '',
      chicagoTime(r.account?.created_at),
      ...(perk ? [yesNo(!!r.perk_eligible)] : []),
    ]);
  });
  return csvText(lines);
}

/** The volunteers CSV from the rows the panel shows. UTF-8 BOM, CRLF. */
export function volunteersCsv(rows: Volunteer[]) {
  const lines: unknown[][] = [
    [
      '#',
      'signed_up_at (Chicago)',
      'name',
      'email',
      'phone',
      'event',
      'source',
      'message',
      'has_account',
      'account_status',
    ],
  ];
  rows.forEach((r, i) => {
    lines.push([
      i + 1,
      chicagoTime(r.created_at),
      r.name || '',
      r.email || '',
      r.phone || '',
      r.event ? r.event.title : 'Any event',
      r.source || '',
      r.message || '',
      yesNo(!!r.account),
      r.account?.status || '',
    ]);
  });
  return csvText(lines);
}

/** Saves `csv` as a file through a Blob URL. */
export function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
