import { supabase } from './supabase';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string };
}

// Calls a Pages Function under /api/. POSTs JSON when a body is given, GETs
// otherwise. `auth` adds the signed-in member's Supabase access token as a
// Bearer header (what requireUser in functions/api/_lib.js checks). Never
// throws: a network failure comes back as { ok: false, status: 0 }.
export async function api<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
  opts: { method?: string; auth?: boolean } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.authorization = `Bearer ${token}`;
  }
  try {
    const res = await fetch(path, {
      method: opts.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = {} as T & { error?: string };
    try {
      data = await res.json();
    } catch {
      // Empty or non-JSON body (e.g. 204): keep {}.
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'network' } as T & { error?: string } };
  }
}
