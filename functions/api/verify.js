// GET /api/verify?m=<member-uuid> — public membership verification page.
// The QR on a member's digital card encodes this URL; a restaurant scans it and
// sees LIVE status (green valid / red not valid), so a screenshot of an expired
// card can't pass. Reveals only name, tier, and validity — nothing else.
import { sb, effectiveMembership } from './_lib.js';
import { tokensEnabled, maskName } from './_tokens.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esc = (s) =>
  String(s ?? '').replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
  );

function page({ ok, name, tierName, until, chargeId }) {
  const color = ok ? '#1a7f37' : '#b3261e';
  const badge = ok ? '✓ VALID MEMBER · 有效会员' : '✗ NOT VALID · 无效或已过期';
  const detail = ok
    ? `<p class="name">${esc(name)}</p>
       <p class="tier">${esc(tierName)}</p>
       ${until ? `<p class="until">Valid through · 有效期至 ${esc(until)}</p>` : ''}`
    : `<p class="tier">This membership could not be verified.<br>无法验证该会员资格。</p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>CAACI Member Verification · 会员验证</title>
<style>
  body{margin:0;font-family:Helvetica,Arial,'cwTeXFangSong',sans-serif;background:#f3f3f3;
       display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:8px;box-shadow:0 15px 80px -6px rgba(0,0,0,.2);
        padding:40px 36px;max-width:420px;width:90%;text-align:center}
  .org{font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#8e2e11;font-weight:700;margin:0 0 18px}
  .badge{display:inline-block;padding:12px 22px;border-radius:999px;font-weight:700;font-size:18px;
         color:#fff;background:${color};margin-bottom:22px}
  .name{font-size:26px;font-weight:700;color:#300200;margin:0 0 6px}
  .tier{font-size:17px;color:#555;margin:0 0 6px}
  .until{font-size:14px;color:#888;margin:0}
  .ts{font-size:12px;color:#aaa;margin-top:26px}
  .charge{display:block;margin-top:22px;padding:14px 18px;border-radius:6px;border:1px solid #8e2e11;
          color:#8e2e11;font-weight:700;font-size:15px;text-decoration:none}
</style></head><body>
<div class="card">
  <p class="org">Chinese American Association of Central Illinois · 华人协会</p>
  <div class="badge">${badge}</div>
  ${detail}
  ${chargeId ? `<a class="charge" href="/charge/?m=${esc(chargeId)}">Merchant sign-in: take tokens · 商家登录扣币</a>` : ''}
  <p class="ts">Checked live at · 实时验证于 ${new Date().toUTCString()}</p>
</div></body></html>`;
}

export async function onRequestGet({ request, env }) {
  const html = (body) =>
    new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  const id = new URL(request.url).searchParams.get('m') || '';
  if (!UUID_RE.test(id)) return html(page({ ok: false }));
  // With tokens on, the same scan is how a merchant starts a charge, and the
  // page shows the family name only (the clerk confirms it out loud).
  const tokens = tokensEnabled(env);
  const chargeId = tokens ? id : '';

  try {
    // A joined family member has no plan of their own: their card is the family plan.
    const plan = await effectiveMembership(sb(env), id);
    if (!plan) return html(page({ ok: false, chargeId }));

    const tier = await sb(env).selectOne('membership_tiers', { id: plan.tier_id }, 'name');
    return html(
      page({
        ok: true,
        name: tokens ? maskName(plan.member.full_name) : plan.member.full_name || 'CAACI Member',
        tierName: tier?.name || plan.tier_id,
        until: plan.expires_at ? new Date(plan.expires_at).toLocaleDateString('en-US') : '',
        chargeId,
      }),
    );
  } catch {
    return html(page({ ok: false }));
  }
}
