// How a public.events row is shown on the events page and the homepage: its
// title and description in the page language, its date and time in Champaign's
// time zone, its registration link and its free gift. DOM-free and
// Supabase-free (the fetch lives in useEvents.ts), so it runs anywhere.
import type { Lang } from './lang';

// Events are stored in UTC and always shown in Champaign's time zone, whatever
// the visitor's device is set to (as on the Tabler registration page).
export const EVENT_TZ = 'America/Chicago';

// The columns the public pages read (all public for published rows, 0002/0018/0020).
export const EVENT_COLUMNS =
  'id,slug,title,title_zh,description,description_zh,starts_at,ends_at,location,image_url,perk_deadline,perk_item_en,perk_item_zh,registration_questions';

export interface EventRow {
  id: string;
  slug: string | null;
  title: string;
  title_zh: string | null;
  description: string | null;
  description_zh: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  image_url: string | null;
  perk_deadline: string | null;
  perk_item_en: string | null;
  perk_item_zh: string | null;
  /** null: no registrations. An array (even empty): the event's own form. */
  registration_questions: unknown[] | null;
}

const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MONTHS_LONG_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

interface Clock {
  year: number;
  month: number;
  day: number;
  weekday: number; // 0 = Sunday; -1 if unknown
  hour: number; // 0-23
  minute: string; // "00"
}

// The wall-clock parts of an instant in Champaign.
export function chicagoClock(iso: string | null | undefined): Clock | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EVENT_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAYS_EN.indexOf(get('weekday')),
    hour: Number(get('hour')) % 24,
    minute: get('minute'),
  };
}

const sameDay = (a: Clock, b: Clock) => a.year === b.year && a.month === b.month && a.day === b.day;
const hour12 = (c: Clock) => c.hour % 12 || 12;
const clockText = (c: Clock) => `${hour12(c)}:${c.minute}`;
const meridiem = (c: Clock) => (c.hour < 12 ? 'AM' : 'PM');
// 凌晨 / 上午 / 中午 / 下午 / 晚上 — how the time of day is said in Chinese.
const period = (c: Clock) =>
  c.hour < 6
    ? '凌晨'
    : c.hour < 12
      ? '上午'
      : c.hour === 12
        ? '中午'
        : c.hour < 18
          ? '下午'
          : '晚上';

// "Sun, Sep 27, 2026" · "2026年9月27日（周日）"
function dayText(c: Clock, lang: Lang, { weekday = true, year = true } = {}) {
  const wd = weekday && c.weekday >= 0;
  if (lang === 'zh')
    return `${year ? `${c.year}年` : ''}${c.month}月${c.day}日${wd ? `（${WEEKDAYS_ZH[c.weekday]}）` : ''}`;
  return `${wd ? `${WEEKDAYS_EN[c.weekday]}, ` : ''}${MONTHS_EN[c.month - 1]} ${c.day}${year ? `, ${c.year}` : ''}`;
}

type Timed = Pick<EventRow, 'starts_at' | 'ends_at'>;

export function eventDateText(ev: Timed, lang: Lang): string {
  const s = chicagoClock(ev.starts_at);
  return s ? dayText(s, lang) : '';
}

// "2:00–7:00 PM" · "11:00 AM–2:00 PM" · "下午2:00–晚上7:00"; the end's date only
// when it is another day.
export function eventTimeText(ev: Timed, lang: Lang): string {
  const s = chicagoClock(ev.starts_at);
  if (!s) return '';
  let e = chicagoClock(ev.ends_at);
  if (e && sameDay(s, e) && e.hour === s.hour && e.minute === s.minute) e = null;
  if (lang === 'zh') {
    const zh = (c: Clock) => `${period(c)}${clockText(c)}`;
    if (!e) return zh(s);
    if (sameDay(s, e)) return `${zh(s)}–${period(s) === period(e) ? clockText(e) : zh(e)}`;
    return `${zh(s)} – ${dayText(e, 'zh', { weekday: false, year: e.year !== s.year })}${zh(e)}`;
  }
  const en = (c: Clock) => `${clockText(c)} ${meridiem(c)}`;
  if (!e) return en(s);
  if (sameDay(s, e))
    return meridiem(s) === meridiem(e) ? `${clockText(s)}–${en(e)}` : `${en(s)}–${en(e)}`;
  return `${en(s)} – ${dayText(e, 'en', { weekday: false, year: e.year !== s.year })}, ${en(e)}`;
}

// "Sun, Sep 27, 2026 · 2:00–7:00 PM"
export function eventWhenText(ev: Timed, lang: Lang): string {
  const date = eventDateText(ev, lang);
  const time = eventTimeText(ev, lang);
  return date && time ? `${date} · ${time}` : date;
}

// The calendar tile: { month: "SEP" | "9月", day: "27", year: "2026" }.
export function eventDateBox(ev: Timed, lang: Lang) {
  const c = chicagoClock(ev.starts_at);
  if (!c) return { month: '', day: '', year: '' };
  return {
    month: lang === 'zh' ? `${c.month}月` : MONTHS_EN[c.month - 1].toUpperCase(),
    day: String(c.day).padStart(2, '0'),
    year: String(c.year),
  };
}

// A deadline with its zone in words, as the registration page words it:
// "September 27, 2:00 PM Central Time" · "9月27日下午2点（美国中部时间）".
export function deadlineText(iso: string | null | undefined, lang: Lang): string {
  const c = chicagoClock(iso);
  if (!c) return '';
  if (lang === 'zh')
    return `${c.month}月${c.day}日${period(c)}${hour12(c)}点${c.minute === '00' ? '' : `${c.minute}分`}（美国中部时间）`;
  return `${MONTHS_LONG_EN[c.month - 1]} ${c.day}, ${clockText(c)} ${meridiem(c)} Central Time`;
}

export const eventTitle = (ev: EventRow, lang: Lang) =>
  lang === 'zh' ? ev.title_zh || ev.title : ev.title;

export const eventDescription = (ev: EventRow, lang: Lang) =>
  (lang === 'zh' ? ev.description_zh || ev.description : ev.description) || '';

// Still on: not yet ended, or (with no end) not yet started. Registration on
// the backend stays open for exactly this long (registrationOpen in _event-form.js).
export function isUpcoming(ev: Timed, now: number = Date.now()): boolean {
  return Date.parse(ev.ends_at ?? ev.starts_at) >= now;
}

// Takes registrations on its own page (/events/<slug>/register/): the questions
// column is an array — /api/event-register treats even an empty one as an open
// form — and there is a slug to put in the address.
export const takesRegistration = (ev: EventRow) =>
  !!ev.slug && Array.isArray(ev.registration_questions);

export const eventsPath = (lang: Lang) => `${lang === 'zh' ? '/zh' : ''}/events/`;

export const registrationPath = (ev: EventRow, lang: Lang) =>
  `/events/${encodeURIComponent(ev.slug ?? '')}/register/${lang === 'zh' ? '?lang=zh' : ''}`;

// The id an event's row carries on the events page, so /events/#<slug> lands on it.
export const eventAnchor = (ev: EventRow) => ev.slug || ev.id;

// What "Share" copies: the registration page when there is one, else the event's row.
export function eventShareUrl(ev: EventRow, lang: Lang, origin: string): string {
  if (takesRegistration(ev)) return `${origin}${registrationPath(ev, lang)}`;
  return `${origin}${eventsPath(lang)}#${encodeURIComponent(eventAnchor(ev))}`;
}

// The free-gift line while it can still be earned (registered and holding a
// CAACI account by perk_deadline, or the start when that is null — the rule the
// backend applies). null when the event has no gift, takes no registrations,
// or the deadline has passed.
export function eventPerkText(ev: EventRow, lang: Lang, now: number = Date.now()): string | null {
  const en = ev.perk_item_en;
  const zh = ev.perk_item_zh;
  if (!en || !zh || !takesRegistration(ev)) return null;
  const deadline = ev.perk_deadline ?? ev.starts_at;
  const end = Date.parse(deadline);
  if (Number.isFinite(end) && now > end) return null;
  const when = deadlineText(deadline, lang);
  return lang === 'zh'
    ? `${when ? `${when}前` : ''}报名并免费注册 CAACI 网站账户，活动现场免费领一份${zh}。`
    : `Free ${en}: register and create a free CAACI website account${when ? ` by ${when}` : ''}, then pick it up at the event.`;
}

// The events page's category chips, guessed from the slug and titles (events
// carry no category column). undefined: shown under "All" only.
export function eventCategory(ev: EventRow): 'culture' | 'job' | 'governance' | undefined {
  const text = `${ev.slug ?? ''} ${ev.title} ${ev.title_zh ?? ''}`.toLowerCase();
  if (
    /autumn|moon|dragon|boat|new[- ]year|lunar|spring|lantern|festival|gala|中秋|端午|春节|新春|元宵/.test(
      text,
    )
  )
    return 'culture';
  if (/job|career|fair|mentor|seminar|workshop|招聘|职业|讲座/.test(text)) return 'job';
  if (/meeting|assembly|by-?law|election|board|大会|章程|选举/.test(text)) return 'governance';
  return undefined;
}

// image_url as set in the admin panel, when it is a same-site path or https.
export function eventImage(ev: EventRow): string | null {
  const url = (ev.image_url || '').trim();
  return /^https:\/\//i.test(url) || /^\/(?!\/)/.test(url) ? url : null;
}
