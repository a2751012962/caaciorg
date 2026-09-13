// /api/admin/news  (admin only)
//   GET  — { test_only }: whether this environment refuses real sends, so
//          Compose News can say so before anyone tries.
//   POST { subject, body_html, audience, confirm } — the real send.
//          Compose-and-send a news email to the membership. Recipient emails are
//          fetched server-side (service role) and NEVER returned to the browser;
//          each member gets their own message (no shared to/cc) so the list isn't
//          leaked. Throttled and requires an explicit confirm to prevent
//          accidental mass-sends.
//   POST { subject, body_html, test: true, test_to } — a test send: only to the
//          signed-in admin and to the addresses in test_to that belong to admin
//          accounts, so it can never mail an arbitrary address from CAACI. The
//          subject is prefixed 【测试 TEST】. No confirm, no audit row, no throttle.
// NEWS_TEST_ONLY=1 (a secret on the Preview environment, which shares the live
// member list and real Resend sending) refuses every real send with 403; test
// sends still work.
import { json, bad, sb, requireAdmin, sendEmailBatch } from '../_lib.js';

const AUDIENCES = ['all', 'active']; // plus 'tier:<id>'
const THROTTLE_MS = 60_000; // min gap between sends
const BATCH = 100; // Resend batch max per call
const MAX_BODY = 200_000; // ~200 KB HTML ceiling
const TEST_EXTRA_MAX = 10; // extra test recipients besides the sender
const TEST_PREFIX = '【测试 TEST】';

const testOnly = (env) => env.NEWS_TEST_ONLY === '1' || env.NEWS_TEST_ONLY === 'true';

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  return json({ test_only: testOnly(env) });
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

  const subject = (b.subject || '').trim();
  const html = (b.body_html || '').trim();
  if (!subject) return bad('Subject is required.');
  if (!html) return bad('Message body is required.');
  if (html.length > MAX_BODY) return bad('Message body is too large.');
  if (b.test === true) return sendTest({ env, gate, subject, html, testTo: b.test_to });

  const audience = (b.audience || 'active').trim();
  if (!b.confirm) return bad('Please confirm before sending.');
  const isTier = audience.startsWith('tier:');
  if (!AUDIENCES.includes(audience) && !isTier) return bad('Invalid audience.');
  if (testOnly(env))
    return bad(
      'This site only sends test emails (NEWS_TEST_ONLY). Send the real email from the live site.',
      403,
    );

  // Fail fast with a clear error rather than reporting one failure per recipient.
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM) return bad('Email is not configured.', 503);

  const DB = sb(env);

  // --- Throttle: reject if a send happened within THROTTLE_MS ---
  try {
    const recent = await DB.select('news_posts', {
      columns: 'created_at',
      order: 'created_at.desc',
      limit: 1,
    });
    const last = recent.rows[0]?.created_at;
    if (last && Date.now() - new Date(last).getTime() < THROTTLE_MS) {
      return bad('A news email was just sent. Please wait a minute before sending another.', 429);
    }
  } catch (e) {
    return bad(e.message, 500);
  }

  // --- Fetch recipients server-side ---
  const filters = [];
  if (audience === 'active') filters.push('status=eq.active');
  else if (isTier) filters.push(`tier_id=eq.${encodeURIComponent(audience.slice(5))}`);
  // 'all' => no status filter, but never email someone with no address.
  filters.push('email=not.is.null');

  let emails;
  try {
    const { rows } = await DB.select('members', { columns: 'email', filters, limit: 10000 });
    emails = [...new Set(rows.map((r) => normEmail(r.email)).filter(Boolean))];
  } catch (e) {
    return bad(e.message, 500);
  }
  if (emails.length === 0) return bad('No recipients match that audience.');

  // --- Claim a send slot BEFORE sending. The audit row is the throttle's source,
  //     so writing it now means a double-click / concurrent request trips the
  //     THROTTLE_MS check on its own read instead of sending twice. ---
  let postId;
  try {
    const rows = await DB.insert('news_posts', {
      subject,
      body_html: html,
      audience,
      recipient_count: 0,
      error_count: 0,
      sent_by: gate.member.id,
    });
    postId = rows?.[0]?.id || null;
  } catch (e) {
    return bad(e.message, 500);
  }

  // --- Send via Resend batch (≤100 distinct messages/call): each member still
  //     gets their own message, but a large blast uses few subrequests and stays
  //     within the Workers per-request subrequest limit. ---
  let sent = 0,
    failed = 0;
  for (let i = 0; i < emails.length; i += BATCH) {
    const chunk = emails.slice(i, i + BATCH);
    try {
      sent += await sendEmailBatch(
        env,
        chunk.map((to) => ({ to, subject, html })),
      );
    } catch {
      failed += chunk.length;
    }
  }

  // --- Finalize the audit row with the result (best effort). ---
  if (postId) {
    try {
      await DB.update('news_posts', { id: postId }, { recipient_count: sent, error_count: failed });
    } catch {
      /* don't fail the response over the audit update */
    }
  }

  return json({ ok: true, sent, failed, total: emails.length });
}

const normEmail = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase();

// The test send: the signed-in admin plus extra addresses, each of which must
// belong to an admin account. Nothing is read from or written to news_posts.
async function sendTest({ env, gate, subject, html, testTo }) {
  const self = normEmail(gate.member.email);
  if (!self) return bad('Your admin account has no email address to send a test to.');
  const raw = Array.isArray(testTo) ? testTo : String(testTo ?? '').split(/[\s,;]+/);
  const extras = [...new Set(raw.map(normEmail).filter(Boolean))].filter((e) => e !== self);
  if (extras.length > TEST_EXTRA_MAX)
    return bad(`At most ${TEST_EXTRA_MAX} extra test recipients.`);
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM) return bad('Email is not configured.', 503);

  if (extras.length) {
    let admins;
    try {
      const { rows } = await sb(env).select('members', {
        columns: 'email',
        filters: ['is_admin=eq.true', 'email=not.is.null'],
        limit: 1000,
      });
      admins = new Set(rows.map((r) => normEmail(r.email)));
    } catch (e) {
      return bad(e.message, 500);
    }
    const outsiders = extras.filter((e) => !admins.has(e));
    if (outsiders.length)
      return bad(`Test emails can only go to admin accounts: ${outsiders.join(', ')}`);
  }

  const recipients = [self, ...extras];
  let sent;
  try {
    sent = await sendEmailBatch(
      env,
      recipients.map((to) => ({ to, subject: `${TEST_PREFIX}${subject}`, html })),
    );
  } catch {
    return bad('The test email could not be sent.', 502);
  }
  return json({ ok: true, test: true, sent, recipients });
}
