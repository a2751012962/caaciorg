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

// A signed-in caller: the headers to hand fakeRequest so requireUser in
// functions/api/_lib.js sees a bearer token. Pair with authRoute below, which
// answers the Supabase Auth lookup that validates it.
export const asUser = (id = 'u1') => ({ authorization: `Bearer session-${id}` });

// Answers GET {SUPABASE_URL}/auth/v1/user as `id`, or null for any other URL so
// a test's own router keeps handling the rest:
//   const r = (url, options) => authRoute(url, 'u1') ?? myRoutes(url, options);
// Pass id = null to play an invalid/expired session (requireUser -> 401).
export function authRoute(url, id = 'u1') {
  if (!url.includes('/auth/v1/user')) return null;
  return id ? { body: { id } } : { status: 401, body: { msg: 'invalid token' } };
}

// A representative environment for the API handlers.
export function fakeEnv(overrides = {}) {
  return {
    SUPABASE_URL: 'https://db.example',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    STRIPE_SECRET_KEY: 'sk_test_123',
    ...overrides,
  };
}
