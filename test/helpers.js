// Shared test utilities: a fake Workers Request, a fetch stub, and a fake env.

// Minimal stand-in for the Workers `Request` shape the handlers actually use:
// `.json()`, `.text()`, `.url`, `.headers.get(name)`, and — when a `formData`
// map is provided — `.formData()`. A fake uploaded file is a plain object like
// { name, type, size, async arrayBuffer() {…} } (see fakeFile below).
export function fakeRequest({
  url = 'https://caaci.example/api',
  body,
  headers = {},
  formData,
} = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    url,
    headers: { get: (name) => lower[String(name).toLowerCase()] ?? null },
    async json() {
      if (body === undefined) throw new SyntaxError('no body');
      if (typeof body === 'string') return JSON.parse(body); // may throw -> "invalid JSON"
      return body;
    },
    async text() {
      return raw;
    },
    async formData() {
      if (!formData) throw new TypeError('not multipart');
      return { get: (name) => formData[name] ?? null };
    },
  };
}

// A fake multipart file entry for fakeRequest({ formData: { file: fakeFile(…) } }).
export function fakeFile({ name = 'photo.jpg', type = 'image/jpeg', size = 1024 } = {}) {
  return {
    name,
    type,
    size,
    async arrayBuffer() {
      return new ArrayBuffer(size);
    },
  };
}

// Installs a `globalThis.fetch` stub. `handler(url, options)` returns either a
// plain object describing the response, or a full { ok, status, json, text }.
// Records every call in `.calls`; `.restore()` puts the real fetch back.
export function mockFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  const stub = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const res = (await handler?.(String(url), options)) ?? {};
    const status = res.status ?? (res.ok === false ? 400 : 200);
    const ok = res.ok ?? (status >= 200 && status < 300);
    const payload = res.body ?? {};
    const headerMap = {};
    for (const [k, v] of Object.entries(res.headers ?? {})) headerMap[k.toLowerCase()] = v;
    return {
      ok,
      status,
      headers: { get: (name) => headerMap[String(name).toLowerCase()] ?? null },
      async json() {
        return typeof payload === 'string' ? JSON.parse(payload) : payload;
      },
      async text() {
        return typeof payload === 'string' ? payload : JSON.stringify(payload);
      },
    };
  };
  stub.calls = calls;
  stub.restore = () => {
    globalThis.fetch = original;
  };
  globalThis.fetch = stub;
  return stub;
}

// --- Turnstile (the human check on the public forms) ---
// The token a protected form sends, and the siteverify answer for it. A test
// for a protected endpoint routes the siteverify call with turnstileRoute and
// puts the token in the body with withTurnstile; fakeEnv already carries the
// secret, so `fakeEnv({ TURNSTILE_SECRET: '' })` is how a test plays "not
// configured yet" (which must refuse, not wave through).
export const TURNSTILE_TOKEN = 'turnstile-token';

// A non-object body (the "invalid JSON" cases send a raw string) passes through
// untouched — there is nothing to add a field to.
export const withTurnstile = (body) =>
  body && typeof body === 'object' ? { ...body, 'cf-turnstile-response': TURNSTILE_TOKEN } : body;

// Answers the siteverify POST for `action`, or null for any other URL so the
// test's own router keeps handling the rest. `hostname` defaults to the host in
// fakeRequest's default url, which is what the handler compares against.
export function turnstileRoute(url, action, { hostname = 'caaci.example', ...rest } = {}) {
  if (!url.includes('challenges.cloudflare.com')) return null;
  return { body: { success: true, action, hostname, ...rest } };
}

// The browser half, for a jsdom page: a sitekey in CAACI_CONFIG and a stand-in
// for the script Cloudflare would have loaded. The stub solves immediately, the
// way a Managed widget does for an ordinary visitor. Returns the render calls so
// a test can assert the action a form asked for, and how often it reset.
export function fakeTurnstile(win, { token = TURNSTILE_TOKEN } = {}) {
  const calls = { render: [], reset: 0, remove: 0 };
  win.CAACI_CONFIG = { ...(win.CAACI_CONFIG || {}), TURNSTILE_SITE_KEY: 'test-sitekey' };
  win.turnstile = {
    render: (el, opts) => {
      calls.render.push(opts);
      opts.callback?.(token);
      return `w${calls.render.length}`;
    },
    reset: () => {
      calls.reset += 1;
    },
    remove: () => {
      calls.remove += 1;
    },
  };
  return calls;
}

// A representative environment for the API handlers.
export function fakeEnv(overrides = {}) {
  return {
    SUPABASE_URL: 'https://db.example',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    STRIPE_SECRET_KEY: 'sk_test_123',
    TURNSTILE_SECRET: 'turnstile-secret',
    ...overrides,
  };
}
