// The browser half of the Turnstile check (functions/api/_turnstile.js is the
// half that decides). Shared by the Tabler/mirror pages and the React site, so
// the two cannot drift apart on the sitekey, the action names or the reset
// discipline.
//
// The script is fetched only when a protected form is actually on the page:
// most visits never see one, and a third-party script on every page is a cost
// without a reason.

// build.mjs writes this next to the Supabase values; it is public by design.
export const siteKey = () =>
  (typeof window !== 'undefined' && window.CAACI_CONFIG?.TURNSTILE_SITE_KEY) || '';

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading = null;

// Resolves with window.turnstile, or null when the script cannot be reached.
// A content blocker or a network that drops challenges.cloudflare.com is the
// realistic case; the server refuses a submission without a token either way,
// so a form has to say what went wrong rather than post into a 403.
export function loadTurnstile() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = SCRIPT;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve(window.turnstile || null);
    el.onerror = () => {
      loading = null; // a later form may try again
      resolve(null);
    };
    document.head.append(el);
  });
  return loading;
}

// Render a widget into `el` for `action` (which the server compares against).
// Returns { token, reset, remove }:
//   token()  the solved token, or '' while it is still working
//   reset()  after every submit — a token is redeemed once, so the next attempt
//            needs a new one, and Turnstile only mints one per reset
//   remove() when the form goes away
// Returns null when the script or the sitekey is missing.
// Why a form cannot be sent, when it cannot: one sentence per language, said
// once the visitor tries. Being specific matters — "please wait" would leave
// someone whose blocker ate the script waiting forever.
export const turnstileUnavailable = (zh) =>
  zh
    ? '安全验证未能加载，可能被浏览器插件或网络拦截。请关闭拦截插件或换一个浏览器后重试。'
    : 'The verification could not load — a content blocker or your network may be stopping it. Turn the blocker off for this site, or try another browser.';

export async function mountTurnstile(el, action, { theme = 'light', lang } = {}) {
  const key = siteKey();
  if (!el || !key) return null;
  const api = await loadTurnstile();
  if (!api) return null;
  // The page already says which language it is in; no caller has to pass it.
  const want = lang || (document.documentElement.lang || 'en').toLowerCase();

  let token = '';
  const id = api.render(el, {
    sitekey: key,
    action,
    theme,
    language: want.startsWith('zh') ? 'zh-cn' : 'en',
    callback: (t) => {
      token = t;
    },
    'expired-callback': () => {
      token = '';
      api.reset(id);
    },
    'error-callback': () => {
      token = '';
    },
  });

  return {
    token: () => token,
    reset: () => {
      token = '';
      try {
        api.reset(id);
      } catch {
        // The widget was removed from the page; nothing to reset.
      }
    },
    remove: () => {
      try {
        api.remove(id);
      } catch {
        // Already gone.
      }
    },
  };
}
