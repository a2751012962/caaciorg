// GET /api/tokens/plans — how many 华协币 each membership plan grants for the
// year, so /membership/ can say so on the plan cards. No session: the visitor
// deciding which plan to buy has not signed in, and often has no account at
// all. token_settings is service-role only (0024 revokes it from anon), so the
// page cannot read the grants straight from Supabase the way it reads tiers.
//
// Answers { enabled: false, grants: {} } while the switch is off, and also when
// the settings row cannot be read: this is a sales page, and a plan card that
// quietly says nothing about tokens is better than one that fails to render.
import { json, sb } from '../_lib.js';
import { tokensEnabled } from '../_tokens.js';

const OFF = { enabled: false, grants: {} };

export async function onRequestGet({ env }) {
  if (!tokensEnabled(env)) return json(OFF);
  try {
    const settings = await sb(env).selectOne('token_settings', { id: true }, 'grants');
    // Only plans that actually grant something, and only whole tokens — the
    // ledger credits an integer (token_membership_grant), so the page should
    // never advertise a number it would not round to.
    const grants = {};
    for (const [tier, n] of Object.entries(settings?.grants || {})) {
      const amount = Math.floor(Number(n));
      if (Number.isFinite(amount) && amount > 0) grants[tier] = amount;
    }
    return json({ enabled: true, grants });
  } catch {
    return json(OFF);
  }
}
