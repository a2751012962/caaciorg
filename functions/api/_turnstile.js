// Cloudflare Turnstile — the human check in front of the public forms that
// cost the association something when a script submits them: the volunteer
// sign-up (which emails whoever is named), the contact form and the business
// listing (which mail staff and write rows), and event registration (which
// emails the registrant).
//
// The browser gets a token from the widget and sends it as `cf-turnstile-response`
// in the JSON body. Only the server may redeem it, and only once: this is the
// single place that talks to siteverify.
//
// Three things are checked, not one. `success` alone would let a token minted
// on any page of any site with this sitekey through, so the action (which
// surface asked for it) and the hostname (which site the widget ran on) are
// compared too.
import { json } from './_lib.js';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Cloudflare documents tokens as at most 2048 characters; longer is not a token.
const MAX_TOKEN_LENGTH = 2048;
const TIMEOUT_MS = 10_000;

// One sentence for every refusal — a bot learns nothing from it, and a person
// who hit a real problem is told what to do. src/lib/registration.js and the
// React forms translate it for /zh/.
export const NOT_HUMAN =
  'We could not confirm you are a person. Please reload the page and try again.';

// The hostnames a token may have been issued on. TURNSTILE_HOSTNAMES (comma
// separated) wins where it is set; otherwise it is this deployment's own
// hostname, which is the strictest answer available and needs no configuration:
// the widget runs on the page that calls this API, so any other hostname means
// the token was minted somewhere else and replayed here.
function allowedHostnames(request, env) {
  const configured = String(env.TURNSTILE_HOSTNAMES || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length) return new Set(configured);
  try {
    return new Set([new URL(request.url).hostname.toLowerCase()]);
  } catch {
    return new Set();
  }
}

// Gate a public handler. Returns {} when the caller proved they are a person,
// or { error: Response } to return as-is — the same shape as requireUser, so it
// reads the same way at the call sites.
//
// `action` must match the widget's data-action on the form this protects.
//
// Fails closed: without TURNSTILE_SECRET nothing is verified, so nothing is
// accepted. That is deliberate — a missing secret must break the form loudly at
// deploy time rather than quietly reopen the mail relay.
export async function requireHuman(request, env, action, token) {
  if (!env.TURNSTILE_SECRET) return { error: json({ error: NOT_HUMAN }, 403) };
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH)
    return { error: json({ error: NOT_HUMAN }, 403) };

  const hostnames = allowedHostnames(request, env);
  if (!hostnames.size) return { error: json({ error: NOT_HUMAN }, 403) };

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET,
    response: token,
  });
  // Cloudflare's own header, set at the edge and not forgeable by the client.
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) body.set('remoteip', ip);

  let result;
  try {
    const r = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body,
    });
    if (!r.ok) throw new Error(`siteverify ${r.status}`);
    result = await r.json();
  } catch {
    // Unreachable, slow, or not JSON. Refuse rather than wave it through.
    return { error: json({ error: NOT_HUMAN }, 403) };
  }

  if (
    result?.success !== true ||
    result.action !== action ||
    !hostnames.has(String(result.hostname || '').toLowerCase())
  ) {
    // A refused submission looks the same to the visitor whether it was a bot
    // or a misconfiguration, so say which in the deployment log — Cloudflare's
    // own codes, the action and the hostname, never the token or the secret.
    // `invalid-input-secret` here means TURNSTILE_SECRET is wrong for this
    // sitekey, which is otherwise indistinguishable from the forms working.
    console.warn(
      'turnstile refused',
      JSON.stringify({
        codes: result?.['error-codes'] ?? null,
        action: result?.action ?? null,
        expected: action,
        hostname: result?.hostname ?? null,
        allowed: [...hostnames],
      }),
    );
    return { error: json({ error: NOT_HUMAN }, 403) };
  }

  return {};
}

// The token as the browser sends it. Kept here so every handler reads the same
// field name, which is also what a plain HTML form post would send.
export const turnstileToken = (body) =>
  typeof body?.['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : '';
