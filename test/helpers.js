// Shared test utilities: a fake Workers Request, a fetch stub, and a fake env.

// Minimal stand-in for the Workers `Request` shape the handlers actually use:
// `.json()`, `.text()`, `.url`, and `.headers.get(name)`.
export function fakeRequest({ url = 'https://caaci.example/api', body, headers = {} } = {}) {
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
    return {
      ok,
      status,
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
