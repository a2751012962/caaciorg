// The CAACI emails, laid out like supabase/templates/*.html: the CAACI
// logo (Storage media/email/caaci-logo.png), a brick rule, Chinese first then
// English, inline styles only, and the association's footer. Pure — callers
// pass the origin, the logo URL and the time.
//   registrationConfirmation — sent by /api/event-register to a first-time
//     registrant. Anyone can make that endpoint mail any address from CAACI,
//     so it carries NO text the registrant typed: not text answers, not an
//     Other answer (only the word "Other"), not even the address. Only option
//     labels and the admin-written event fields, all escaped.
//   newsTemplate — the templates in admin Compose News
//     (/api/admin/news-template), for the admin to edit and send: for one
//     event an announcement (eventAnnouncement), a reminder and a thank-you;
//     with no event a general announcement and a membership renewal reminder.
//     Text only the admin can write is left as 【待填写：…】 / [To fill in: …],
//     and /api/admin/news refuses a message that still has it (PLACEHOLDER).
// Each layout is written once, as a Resend Template with {{{VARIABLE}}}
// placeholders (templateVariables, synced by resend-templates.mjs). Rendering
// an email fills that same template with pre-escaped HTML slots taken from the
// event, so the email sent and the template stored are one markup.
// Times: the event's own time as Intl's full date in Champaign (no zone name);
// deadlines as words — "September 27, 2:00 PM Central Time" /
// "9月27日下午2点（美国中部时间）" — never Intl's "GMT-5" / "CDT".
import { perkOf, choiceAnswerLabels } from './_event-form.js';

const TZ = 'America/Chicago'; // times are stored in UTC; the events are in Champaign
const BRICK = '#8e2e11';
const INK = '#300200';
const HEADING = `margin:0 0 8px;color:${INK};font-size:20px;`;
const SMALL = 'font-size:13px;color:#666666;';
const LINK = 'color:#cd5c5c;';

// Text a template leaves for the admin to replace before sending.
export const PLACEHOLDER = /【待填写|\[To fill in/;

export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export const emailLogo = (supabaseUrl) =>
  `${supabaseUrl}/storage/v1/object/public/media/email/caaci-logo.png`;

// A timestamp as Champaign wall-clock time.
const chicago = (iso, locale, opts = { dateStyle: 'full', timeStyle: 'short' }) =>
  new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts }).format(new Date(iso));

// "Sunday, September 27, 2026 at 2:00 PM – 6:00 PM": the end's date only if it differs.
function eventTime(event, locale) {
  const start = chicago(event.starts_at, locale);
  if (!event.ends_at) return start;
  const day = (iso) => chicago(iso, locale, { dateStyle: 'short' });
  const sameDay = day(event.starts_at) === day(event.ends_at);
  return `${start} – ${chicago(event.ends_at, locale, sameDay ? { timeStyle: 'short' } : undefined)}`;
}

const MONTHS = [
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

// "September 27, 2:00 PM Central Time" · "9月27日下午2点（美国中部时间）", assembled
// from the Chicago clock like deadlineText in src/caaci-member.js; '' if invalid.
export function centralTime(iso, lang) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const hour = Number(get('hour'));
  const month = Number(get('month'));
  const [day, minute] = [get('day'), get('minute')];
  const hour12 = hour % 12 || 12;
  if (lang === 'zh') {
    const period =
      hour < 6 ? '凌晨' : hour < 12 ? '上午' : hour === 12 ? '中午' : hour < 18 ? '下午' : '晚上';
    return `${month}月${day}日${period}${hour12}点${minute === '00' ? '' : `${minute}分`}（美国中部时间）`;
  }
  return `${MONTHS[month - 1]} ${day}, ${hour12}:${minute} ${hour >= 12 ? 'PM' : 'AM'} Central Time`;
}

// ------------------------------------------------------------------ layout ----

function frame(s, inner) {
  return `<div style="max-width:600px;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;font-size:15px;line-height:1.6;color:#333333;">
  <a href="${s.SITE_URL}/" style="text-decoration:none;">
    <img src="${s.LOGO_URL}" width="200" alt="CAACI 华人协会" style="display:block;width:200px;height:auto;border:0;">
  </a>

  <div style="border-top:3px solid ${BRICK};margin:16px 0 24px;"></div>

${inner}

  <div style="border-top:1px solid #dddddd;padding-top:16px;font-size:12px;line-height:1.7;color:#666666;">
    <strong style="color:${INK};">Chinese American Association of Central Illinois</strong><br>
    美中伊利诺伊中部华人协会<br>
    P.O. Box 2276, Champaign, IL 61825<br>
    <a href="mailto:caaci.org@gmail.com" style="${LINK}">caaci.org@gmail.com</a> · <a href="${s.SITE_URL}/" style="${LINK}">${s.SITE_HOST}</a>
  </div>
</div>`;
}

const whenWhere = (s) => `  <p style="margin:0 0 24px;">
    <strong style="color:${INK};">时间 · When</strong><br>
    ${s.WHEN_ZH}<br>
    ${s.WHEN_EN}<br>
    <span style="${SMALL}">美国中部时间 · Central Time</span>${s.WHERE_HTML}
  </p>`;

const button = (
  href,
  label,
) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr>
      <td bgcolor="${BRICK}" style="border-radius:4px;">
        <a href="${href}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:bold;">${label}</a>
      </td>
    </tr></table>`;

const confirmationSubject = (titleZh) => `${titleZh} · 报名确认 / Registration confirmed`;
const confirmationLayout = (s) =>
  frame(
    s,
    `  <h2 style="${HEADING}">报名成功</h2>
  <p style="margin:0 0 20px;">感谢报名 <strong>${s.EVENT_TITLE_ZH}</strong>！以下是你的报名摘要。</p>

  <h2 style="${HEADING}">You're registered</h2>
  <p style="margin:0 0 24px;">Thanks for registering for <strong>${s.EVENT_TITLE}</strong>! Here is a summary of your registration.</p>

${whenWhere(s)}

  ${s.ANSWERS_HTML}

  ${s.PERK_HTML}

  <p style="margin:0 0 28px;${SMALL}">如需修改，请用同一邮箱再次提交报名表。<br>To change your answers, submit the form again with the same email.</p>`,
  );

const announcementSubject = (titleZh, title) =>
  `${titleZh} · ${title} 报名开始 / Registration open`;
const announcementLayout = (s) =>
  frame(
    s,
    `  <h2 style="${HEADING}">${s.EVENT_TITLE_ZH} 报名开始</h2>
  <p style="margin:0 0 20px;">欢迎报名参加 <strong>${s.EVENT_TITLE_ZH}</strong>。</p>

  <h2 style="${HEADING}">Registration is open</h2>
  <p style="margin:0 0 24px;">Register now for <strong>${s.EVENT_TITLE}</strong>.</p>

${whenWhere(s)}

  ${s.DESCRIPTION_HTML}

  ${s.PERK_HTML}

  ${button(s.REGISTER_URL, '报名 · Register')}
  <p style="margin:0 0 28px;${SMALL}">或打开此链接报名：<br>Or register at: <a href="${s.REGISTER_URL}" style="${LINK}">${s.REGISTER_URL}</a></p>`,
  );

const reminderSubject = (titleZh, title) => `${titleZh} · ${title} 活动提醒 / Event reminder`;
const reminderLayout = (s) =>
  frame(
    s,
    `  <h2 style="${HEADING}">${s.EVENT_TITLE_ZH} 即将举行</h2>
  <p style="margin:0 0 20px;">提醒您：<strong>${s.EVENT_TITLE_ZH}</strong> 即将举行，期待与您相见！</p>

  <h2 style="${HEADING}">Coming up soon</h2>
  <p style="margin:0 0 24px;">A reminder that <strong>${s.EVENT_TITLE}</strong> is coming up soon. We look forward to seeing you!</p>

${whenWhere(s)}

  ${s.PERK_HTML}

  ${s.ACTION_HTML}`,
  );

const thanksSubject = (titleZh, title) => `${titleZh} · ${title} 感谢参与 / Thank you`;
const thanksLayout = (s) =>
  frame(
    s,
    `  <h2 style="${HEADING}">感谢参与${s.EVENT_TITLE_ZH}</h2>
  <p style="margin:0 0 20px;">感谢大家参加 <strong>${s.EVENT_TITLE_ZH}</strong>！【待填写：几句活动回顾，例如参加人数和精彩瞬间】</p>

  <h2 style="${HEADING}">Thank you for joining us</h2>
  <p style="margin:0 0 24px;">Thank you for coming to <strong>${s.EVENT_TITLE}</strong>! [To fill in: a few lines about the event, such as turnout and highlights]</p>

  <!-- 没有照片就删掉下面这一段 · Delete the next paragraph if there are no photos -->
  <p style="margin:0 0 24px;">
    <strong style="color:${INK};">活动照片 · Photos</strong><br>
    【待填写：相册链接】 [To fill in: photo album link]
  </p>

  ${button(`${s.SITE_URL}/events/`, '近期活动 · Upcoming events')}
  <p style="margin:0 0 28px;${SMALL}">期待在下次活动与您相见！<br>We hope to see you at our next event!</p>`,
  );

const GENERAL_SUBJECT = 'CAACI 通讯 / CAACI News';
const generalLayout = (s) =>
  frame(
    s,
    `  <!-- 每段一个 <p>…</p>，不需要的部分可以删掉 · One <p>…</p> per paragraph; delete what you don't need -->
  <h2 style="${HEADING}">【待填写：中文标题】</h2>
  <p style="margin:0 0 20px;">【待填写：中文正文】</p>

  <h2 style="${HEADING}">[To fill in: English heading]</h2>
  <p style="margin:0 0 24px;">[To fill in: English text]</p>

  ${button(`${s.SITE_URL}/`, `访问网站 · Visit ${s.SITE_HOST}`)}
  <p style="margin:0 0 28px;${SMALL}">如有问题，请写信至 <a href="mailto:caaci.org@gmail.com" style="${LINK}">caaci.org@gmail.com</a>。<br>Questions? Email us at <a href="mailto:caaci.org@gmail.com" style="${LINK}">caaci.org@gmail.com</a>.</p>`,
  );

const RENEWAL_SUBJECT = 'CAACI 会员续费提醒 / Membership renewal reminder';
const renewalLayout = (s) =>
  frame(
    s,
    `  <h2 style="${HEADING}">会员续费提醒</h2>
  <p style="margin:0 0 20px;">感谢您对美中伊利诺伊中部华人协会（CAACI）的支持！如果您的会员已经到期或即将到期，请登录网站续费，继续享受会员权益。</p>

  <h2 style="${HEADING}">Time to renew your membership</h2>
  <p style="margin:0 0 24px;">Thank you for supporting the Chinese American Association of Central Illinois! If your membership has expired or is about to, please sign in and renew to keep your member benefits.</p>

  ${button(`${s.SITE_URL}/membership/`, '续费会员 · Renew membership')}
  <p style="margin:0 0 28px;${SMALL}">登录后可在<a href="${s.SITE_URL}/account/" style="${LINK}">我的账户</a>查看会员到期日期。已开启自动续费的会员无需任何操作。<br>Sign in to see when your membership expires under <a href="${s.SITE_URL}/account/" style="${LINK}">My Account</a>. If your membership renews automatically, you don't need to do anything.</p>`,
  );

// ------------------------------------------------------------------- slots ----

// The slots every email shares: the site's link, host and logo.
function siteSlots({ origin, logo }) {
  return {
    SITE_URL: esc(origin),
    SITE_HOST: esc(new URL(origin).host),
    LOGO_URL: esc(logo),
  };
}

// The slots every event email shares, escaped from the event.
function commonSlots({ origin, logo, event }) {
  return {
    ...siteSlots({ origin, logo }),
    EVENT_TITLE_ZH: esc(event.title_zh || event.title),
    EVENT_TITLE: esc(event.title),
    WHEN_ZH: esc(eventTime(event, 'zh-CN')),
    WHEN_EN: esc(eventTime(event, 'en-US')),
    WHERE_HTML: event.location
      ? `<br><strong style="color:${INK};">地点 · Where</strong><br>${esc(event.location)}`
      : '',
  };
}

const registerUrl = (origin, event) =>
  esc(`${origin}/events/${encodeURIComponent(event.slug)}/register/`);

// The free-gift box: its title and the paragraphs under it; '' when the event
// has no gift or its deadline has passed.
function perkBox(event, now, paragraphs) {
  const perk = perkOf(event);
  if (!perk || !(Number(now) <= Date.parse(perk.deadline))) return '';
  const copy = {
    zh: esc(perk.item_zh),
    en: esc(perk.item_en),
    whenZh: esc(centralTime(perk.deadline, 'zh')),
    whenEn: esc(centralTime(perk.deadline, 'en')),
  };
  return `<div style="border-left:3px solid ${BRICK};padding:4px 0 4px 16px;margin:0 0 24px;">
    <p style="margin:0 0 8px;color:${INK};font-weight:bold;">免费领${copy.zh} · Free ${copy.en}</p>
    ${paragraphs(copy)}
  </div>`;
}

// The gift box for an email that invites people to register: the wording
// approved for the Mid-Autumn page, with the event's own gift.
const registerPerk = (event, now) =>
  perkBox(
    event,
    now,
    (
      c,
    ) => `<p style="margin:0 0 8px;">${c.whenZh}前报名，并免费注册一个 CAACI 网站账户，活动当天就能在现场免费领一份${c.zh}。</p>
    <p style="margin:0 0 8px;${SMALL}">不注册账户也可以报名参加活动，只是领不到${c.zh}。</p>
    <p style="margin:0 0 8px;">Register and create a free CAACI website account by ${c.whenEn}, and pick up your free ${c.en} at the event.</p>
    <p style="margin:0;${SMALL}">You can register without an account — you just won't get the free ${c.en}.</p>`,
  );

// One row per choice question: option labels only (Other as the word). Text
// questions are left out entirely — their answers are typed text.
function answersTable(questions, answers) {
  const rows = (questions || [])
    .filter((q) => q.type === 'single' || q.type === 'multi')
    .map((q) => {
      const zh = choiceAnswerLabels(q, answers?.[q.id], 'zh');
      const en = choiceAnswerLabels(q, answers?.[q.id], 'en');
      const value = zh.length ? `${esc(zh.join('、'))} · ${esc(en.join(', '))}` : '—';
      return (
        `<tr><td style="padding:6px 16px 6px 0;vertical-align:top;${SMALL}">${esc(q.label_zh)} · ${esc(q.label_en)}</td>` +
        `<td style="padding:6px 0;vertical-align:top;">${value}</td></tr>`
      );
    });
  if (!rows.length) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;font-size:15px;">
    ${rows.join('\n    ')}
  </table>`;
}

// ------------------------------------------------------------------ emails ----

export function registrationConfirmation({
  origin,
  logo,
  event,
  questions,
  answers,
  linked,
  now = Date.now(),
}) {
  const perk = perkBox(event, now, (c) =>
    linked
      ? `<p style="margin:0 0 8px;">✓ 你的报名已关联你的 CAACI 账户，活动当天可在现场免费领一份${c.zh}。</p>
    <p style="margin:0;">✓ Your registration is linked to your CAACI account, so it counts for your free ${c.en} at the event.</p>`
      : `<p style="margin:0 0 8px;">${c.whenZh}前用此邮箱免费注册一个 CAACI 网站账户，活动当天就能在现场免费领一份${c.zh}。</p>
    <p style="margin:0 0 16px;">Create a free CAACI website account with this email by ${c.whenEn}, and pick up your free ${c.en} at the event.</p>
    ${button(`${esc(origin)}/login-3/`, '注册免费账户 · Create a free account')}
    <p style="margin:0;${SMALL}">已经用此邮箱注册过 CAACI 账户？无需其他操作。<br>Already have a CAACI account with this email? You're all set.</p>`,
  );
  return {
    subject: confirmationSubject(event.title_zh || event.title),
    html: fill(CONFIRMATION.html, {
      ...commonSlots({ origin, logo, event }),
      ANSWERS_HTML: answersTable(questions, answers),
      PERK_HTML: perk,
    }),
  };
}

export function eventAnnouncement({ origin, logo, event, now = Date.now() }) {
  // Chinese first, like the titles; one paragraph when only one is set or both match.
  const descriptions = [
    ...new Set(
      [event.description_zh, event.description].map((d) => String(d ?? '').trim()).filter(Boolean),
    ),
  ];
  return {
    subject: announcementSubject(event.title_zh || event.title, event.title),
    html: fill(ANNOUNCEMENT.html, {
      ...commonSlots({ origin, logo, event }),
      DESCRIPTION_HTML: descriptions
        .map(
          (d, i) =>
            `<p style="margin:0 0 ${i === descriptions.length - 1 ? 24 : 8}px;">${esc(d).replace(/\r?\n/g, '<br>')}</p>`,
        )
        .join('\n    '),
      PERK_HTML: registerPerk(event, now),
      REGISTER_URL: registerUrl(origin, event),
    }),
  };
}

// The Compose News templates by name: EVENT_NEWS_TEMPLATES are rendered for one
// event, SITE_NEWS_TEMPLATES need none.
export const EVENT_NEWS_TEMPLATES = Object.freeze(['announcement', 'reminder', 'thanks']);
export const SITE_NEWS_TEMPLATES = Object.freeze(['general', 'renewal']);

// { subject, html } for one Compose News template. `event` is required for the
// event templates and ignored by the others.
export function newsTemplate(name, { origin, logo, event, now = Date.now() }) {
  const titles = () => [event.title_zh || event.title, event.title];
  switch (name) {
    case 'announcement':
      return eventAnnouncement({ origin, logo, event, now });
    case 'reminder': {
      // The registration link only for an event that takes registrations; the
      // gift wording asks people to register, so it goes with it.
      const slots = commonSlots({ origin, logo, event });
      const registering = event.registration_questions != null;
      const url = registerUrl(origin, event);
      return {
        subject: reminderSubject(...titles()),
        html: fill(REMINDER.html, {
          ...slots,
          PERK_HTML: registering ? registerPerk(event, now) : '',
          ACTION_HTML: registering
            ? `${button(url, '报名 · Register')}
  <p style="margin:0 0 28px;${SMALL}">还没报名，或想修改报名？请用同一邮箱打开此链接提交：<br>Not registered yet, or need to change your answers? Use the same email at: <a href="${url}" style="${LINK}">${url}</a></p>`
            : `<p style="margin:0 0 28px;${SMALL}">更多活动信息 · More events: <a href="${slots.SITE_URL}/events/" style="${LINK}">${slots.SITE_URL}/events/</a></p>`,
        }),
      };
    }
    case 'thanks':
      return {
        subject: thanksSubject(...titles()),
        html: fill(THANKS.html, commonSlots({ origin, logo, event })),
      };
    case 'general':
      return { subject: GENERAL_SUBJECT, html: fill(GENERAL.html, siteSlots({ origin, logo })) };
    case 'renewal':
      return { subject: RENEWAL_SUBJECT, html: fill(RENEWAL.html, siteSlots({ origin, logo })) };
    default:
      throw new Error(`Unknown news template: ${name}`);
  }
}

// ------------------------------------------------------- Resend templates ----

// Every layout as a Resend Template (synced by resend-templates.mjs; nothing
// on the site sends through Resend's copies). Every slot is a {{{KEY}}}
// placeholder — triple braces, so Resend inserts the value unescaped, which
// means a sender must pass HTML-escaped values, exactly what siteSlots() and
// commonSlots() build. ANSWERS_HTML, PERK_HTML, WHERE_HTML, DESCRIPTION_HTML
// and ACTION_HTML are whole sections of HTML ('' to leave one out).

// One pass over the template: a value that itself contains "{{{KEY}}}" (an
// admin could type that into a title) is inserted as it is, never expanded.
const fill = (text, values) =>
  text.replace(/\{\{\{([A-Z0-9_]+)\}\}\}/g, (m, key) =>
    Object.hasOwn(values, key) ? values[key] : m,
  );

const SITE_KEYS = ['SITE_URL', 'SITE_HOST', 'LOGO_URL'];
const TITLE_KEYS = [...SITE_KEYS, 'EVENT_TITLE_ZH', 'EVENT_TITLE'];
const COMMON_KEYS = [...TITLE_KEYS, 'WHEN_ZH', 'WHEN_EN', 'WHERE_HTML'];
const placeholders = (keys) => Object.fromEntries(keys.map((k) => [k, `{{{${k}}}}`]));
const template = ({ alias, name, keys, subject, layout }) =>
  Object.freeze({
    alias,
    name,
    subject,
    html: layout(placeholders(keys)),
    variables: keys.map((key) => ({ key, type: 'string' })),
  });

const CONFIRMATION_KEYS = [...COMMON_KEYS, 'ANSWERS_HTML', 'PERK_HTML'];
const ANNOUNCEMENT_KEYS = [...COMMON_KEYS, 'DESCRIPTION_HTML', 'PERK_HTML', 'REGISTER_URL'];
const REMINDER_KEYS = [...COMMON_KEYS, 'PERK_HTML', 'ACTION_HTML'];

const CONFIRMATION = template({
  alias: 'event-registration-confirmation',
  name: 'CAACI event registration confirmation',
  keys: CONFIRMATION_KEYS,
  subject: confirmationSubject('{{{EVENT_TITLE_ZH}}}'),
  layout: confirmationLayout,
});
const ANNOUNCEMENT = template({
  alias: 'event-announcement',
  name: 'CAACI event announcement',
  keys: ANNOUNCEMENT_KEYS,
  subject: announcementSubject('{{{EVENT_TITLE_ZH}}}', '{{{EVENT_TITLE}}}'),
  layout: announcementLayout,
});
const REMINDER = template({
  alias: 'event-reminder',
  name: 'CAACI event reminder',
  keys: REMINDER_KEYS,
  subject: reminderSubject('{{{EVENT_TITLE_ZH}}}', '{{{EVENT_TITLE}}}'),
  layout: reminderLayout,
});
const THANKS = template({
  alias: 'event-thank-you',
  name: 'CAACI event thank-you',
  keys: TITLE_KEYS,
  subject: thanksSubject('{{{EVENT_TITLE_ZH}}}', '{{{EVENT_TITLE}}}'),
  layout: thanksLayout,
});
const GENERAL = template({
  alias: 'news-general',
  name: 'CAACI general announcement',
  keys: SITE_KEYS,
  subject: GENERAL_SUBJECT,
  layout: generalLayout,
});
const RENEWAL = template({
  alias: 'membership-renewal-reminder',
  name: 'CAACI membership renewal reminder',
  keys: SITE_KEYS,
  subject: RENEWAL_SUBJECT,
  layout: renewalLayout,
});

// [{ alias, name, subject, html, variables: [{ key, type }] }]
export const templateVariables = Object.freeze([
  CONFIRMATION,
  ANNOUNCEMENT,
  REMINDER,
  THANKS,
  GENERAL,
  RENEWAL,
]);
