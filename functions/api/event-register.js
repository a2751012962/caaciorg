// /api/event-register — public registration for an event, no account needed
// (first use: the Mid-Autumn Festival form at /mid_autumn_festival_form/).
//   GET  ?event=<slug> — the published event's details and its free-gift
//        deadline. With a valid Authorization: Bearer <supabase access token>,
//        also the caller's email and their registration, so the page can prefill
//        the form or show "registered". Signed out, nothing about any email.
//   POST — create or update the registration for (event, email). A resubmission
//        overwrites the answers but keeps created_at, the first submission time
//        that decides the free mooncake; only the first one gets a confirmation.
// A bad or expired token is treated as signed out, never as an error.
// event_registrations is server-only (0015): read and written here and by
// /api/admin/event-registrations, with the service-role key.
import { json, bad, sb, sendEmail, requireUser } from './_lib.js';

const TZ = 'America/Chicago'; // times are stored in UTC; the events are in Champaign
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEARD_FROM = {
  website: 'Website',
  friend: 'Friend',
  newsletter: 'Newsletter',
  social: 'Social Media',
};
const BAD_HEARD_FROM = 'Invalid answer for how you heard about the event.';

// The free-gift cutoff: the event's own perk_deadline, else its start (inclusive).
const deadlineOf = (event) => event.perk_deadline ?? event.starts_at;

// The signed-in user behind the bearer token, or null.
async function optionalUser(request, env) {
  try {
    return (await requireUser(request, env)).user || null;
  } catch {
    return null; // auth unreachable: carry on signed out
  }
}

export async function onRequestGet({ request, env }) {
  const slug = (new URL(request.url).searchParams.get('event') || '').trim();
  if (!slug) return bad('event required');

  try {
    const DB = sb(env);
    const event = await DB.selectOne(
      'events',
      { slug },
      'id,slug,title,description,starts_at,ends_at,location,perk_deadline,published',
    );
    if (!event || event.published !== true) return bad('Event not found.', 404);

    const out = {
      event: {
        slug: event.slug,
        title: event.title,
        description: event.description,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        location: event.location,
        perk_deadline: event.perk_deadline,
        deadline: deadlineOf(event),
      },
      signed_in: false,
    };
    const user = await optionalUser(request, env);
    if (!user) return json(out);

    // By the login email first (it may have been sent signed out), else by the
    // account (signed in, but under another address). Two eq lookups: an email
    // can contain PostgREST syntax, so it never goes into an or=() filter.
    const cols = 'created_at,attending,updated_at';
    const email = String(user.email || '').toLowerCase();
    const reg =
      (email && (await DB.selectOne('event_registrations', { event_id: event.id, email }, cols))) ||
      (await DB.selectOne('event_registrations', { event_id: event.id, member_id: user.id }, cols));
    return json({
      ...out,
      signed_in: true,
      email: user.email || null,
      registration: reg
        ? { registered_at: reg.created_at, attending: reg.attending, updated_at: reg.updated_at }
        : null,
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  if (!b || typeof b !== 'object') return bad('invalid JSON');
  if (b._hp) return json({ ok: true }); // honeypot: silently accept bots

  const slug = String(b.event ?? '').trim();
  if (!slug) return bad('event required');

  const email = String(b.email ?? '')
    .trim()
    .toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return bad('Enter a valid email address.');

  if (b.attending !== 'yes' && b.attending !== 'no') return bad('Tell us whether you can attend.');
  const attending = b.attending === 'yes';

  const names = String(b.names ?? '').trim();
  if (names.length > 1000) return bad('Names are too long.');
  if (attending && !names) return bad('List the names of the people attending.');

  let heardFrom = null;
  const heard = b.heard_from ?? '';
  if (heard === 'other') {
    const other = String(b.heard_from_other ?? '').trim();
    if (other.length > 200) return bad(BAD_HEARD_FROM);
    heardFrom = other || 'Other';
  } else if (Object.hasOwn(HEARD_FROM, heard)) {
    heardFrom = HEARD_FROM[heard];
  } else if (heard !== '') {
    return bad(BAD_HEARD_FROM);
  }

  const wantsMeal = b.wants_meal === 'yes' ? true : b.wants_meal === 'no' ? false : null;

  try {
    const DB = sb(env);
    const event = await DB.selectOne(
      'events',
      { slug },
      'id,title,starts_at,ends_at,location,perk_deadline,published',
    );
    if (!event || event.published !== true) return bad('Event not found.', 404);

    const memberId = (await optionalUser(request, env))?.id || null;

    const existing = await DB.selectOne(
      'event_registrations',
      { event_id: event.id, email },
      'id,created_at',
    );
    // Never send created_at: the first submission time must survive a
    // resubmission. Never send member_id: null: a signed-out resubmission must
    // not unlink the account an earlier signed-in one recorded.
    const [row] = await DB.upsert(
      'event_registrations',
      {
        event_id: event.id,
        email,
        attending,
        attendee_names: names || null,
        heard_from: heardFrom,
        wants_meal: wantsMeal,
        updated_at: new Date().toISOString(),
        ...(memberId ? { member_id: memberId } : {}),
      },
      { onConflict: 'event_id,email' },
    );

    const deadline = deadlineOf(event);
    if (!existing) {
      try {
        const url = new URL(request.url);
        await sendEmail(env, {
          to: email,
          replyTo: env.NOTIFY_TO,
          subject: `${event.title} · 报名确认 / Registration confirmed`,
          html: confirmationHtml({
            origin: url.origin,
            host: url.host,
            logo: `${env.SUPABASE_URL}/storage/v1/object/public/media/email/caaci-logo.png`,
            event,
            deadline,
            signedIn: !!memberId,
            answers: { email, attending, names, heardFrom, wantsMeal },
          }),
        });
      } catch {
        // The registration is saved; a lost confirmation must not fail the form.
      }
    }

    return json({
      ok: true,
      already: !!existing,
      registered_at: existing?.created_at ?? row?.created_at ?? null,
      signed_in: !!memberId,
      deadline,
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

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

// The registrant's confirmation, laid out like supabase/templates/*.html:
// Chinese first, then English. Everything user- or admin-supplied is escaped.
function confirmationHtml({ origin, host, logo, event, deadline, signedIn, answers }) {
  const title = esc(event.title);
  const heading = 'margin:0 0 8px;color:#300200;font-size:20px;';
  const small = 'font-size:13px;color:#666666;';
  const text = (v) => (v ? esc(v).replace(/\r?\n/g, '<br>') : '—');
  const row = (label, value) =>
    `<tr><td style="padding:6px 16px 6px 0;vertical-align:top;${small}">${label}</td>` +
    `<td style="padding:6px 0;vertical-align:top;">${value}</td></tr>`;

  // Only offer the mooncake while it can still be earned.
  let perk = '';
  if (Date.now() <= new Date(deadline).getTime()) {
    const body = signedIn
      ? `<p style="margin:0 0 8px;">✓ 你的报名已关联你的 CAACI 账号，可在活动现场领取一个免费月饼。</p>
    <p style="margin:0;">✓ Your registration is linked to your CAACI account, so it counts for a free mooncake at the festival.</p>`
      : `<p style="margin:0 0 8px;">在 ${esc(chicago(deadline, 'zh-CN'))}（美国中部时间）之前，用此邮箱注册一个免费 CAACI 账号，即可在活动现场领取一个免费月饼。</p>
    <p style="margin:0 0 16px;">Create a free CAACI account with this email before ${esc(chicago(deadline, 'en-US'))} (Central Time) to get a free mooncake at the festival.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr>
      <td bgcolor="#8e2e11" style="border-radius:4px;">
        <a href="${esc(origin)}/login-3/" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:bold;">注册免费账号 · Create a free account</a>
      </td>
    </tr></table>
    <p style="margin:0;${small}">已经用此邮箱注册过 CAACI 账号？无需其他操作。<br>Already have a CAACI account with this email? You're all set.</p>`;
    perk = `<div style="border-left:3px solid #8e2e11;padding:4px 0 4px 16px;margin:0 0 24px;">
    <p style="margin:0 0 8px;color:#300200;font-weight:bold;">免费月饼 · Free mooncake</p>
    ${body}
  </div>`;
  }

  const { email, attending, names, heardFrom, wantsMeal } = answers;
  return `<div style="max-width:600px;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;font-size:15px;line-height:1.6;color:#333333;">
  <a href="${esc(origin)}/" style="text-decoration:none;">
    <img src="${esc(logo)}" width="200" alt="CAACI 华人协会" style="display:block;width:200px;height:auto;border:0;">
  </a>

  <div style="border-top:3px solid #8e2e11;margin:16px 0 24px;"></div>

  <h2 style="${heading}">报名成功</h2>
  <p style="margin:0 0 20px;">感谢报名 <strong>${title}</strong>！以下是你提交的信息，供你留存。</p>

  <h2 style="${heading}">You're registered</h2>
  <p style="margin:0 0 24px;">Thanks for registering for <strong>${title}</strong>! Here is a copy of your answers.</p>

  <p style="margin:0 0 24px;">
    <strong style="color:#300200;">时间 · When</strong><br>
    ${esc(eventTime(event, 'zh-CN'))}<br>
    ${esc(eventTime(event, 'en-US'))}<br>
    <span style="${small}">美国中部时间 · Central Time</span>
    ${event.location ? `<br><strong style="color:#300200;">地点 · Where</strong><br>${esc(event.location)}` : ''}
  </p>

  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;font-size:15px;">
    ${row('邮箱 · Email', esc(email))}
    ${row('能否参加 · Can you attend?', attending ? '我会参加 · Yes, I’ll be there' : '无法参加 · Sorry, can’t make it')}
    ${row('参加人员 · Names of people attending', text(names))}
    ${row('了解渠道 · How you heard about this event', text(heardFrom))}
    ${row('购买餐食 · Purchase a meal?', wantsMeal === true ? '是 · Yes' : wantsMeal === false ? '否 · No' : '—')}
  </table>

  ${perk}

  <p style="margin:0 0 28px;${small}">如需修改，请用同一邮箱再次提交报名表。<br>To change your answers, submit the form again with the same email.</p>

  <div style="border-top:1px solid #dddddd;padding-top:16px;font-size:12px;line-height:1.7;color:#666666;">
    <strong style="color:#300200;">Chinese American Association of Central Illinois</strong><br>
    美中伊利诺伊中部华人协会<br>
    P.O. Box 2276, Champaign, IL 61825<br>
    <a href="mailto:caaci.org@gmail.com" style="color:#cd5c5c;">caaci.org@gmail.com</a> · <a href="${esc(origin)}/" style="color:#cd5c5c;">${esc(host)}</a>
  </div>
</div>`;
}
