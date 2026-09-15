import { createClient } from '@supabase/supabase-js';

// build.mjs writes the public URL + anon key to /assets/caaci-config.js, which
// index.html loads before this bundle. The Tabler login page (/login-3/) uses
// the same values with default client options, so both share one session in
// localStorage (sb-<ref>-auth-token): signing in there signs you in here.
declare global {
  interface Window {
    CAACI_CONFIG?: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string };
  }
}

const cfg = window.CAACI_CONFIG;
if (!cfg?.SUPABASE_URL || !cfg?.SUPABASE_ANON_KEY) {
  throw new Error('CAACI_CONFIG missing: /assets/caaci-config.js did not load');
}

export const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
