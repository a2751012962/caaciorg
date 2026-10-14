// /api/site-content  (public) — the page-copy overrides editors saved in
// /admin/ (site_content, 0040). The site loads this at boot and lays the
// values over the defaults in web/src/data/ (web/src/lib/siteContent.ts).
//   GET → { overrides: { [key]: { en?: json, zh?: json } } }, with only the
//         languages that are set: a missing language keeps the code's default.
// Only ever reads, with the service-role key; answers may be cached for 30 seconds.
import { json, bad, sb } from './_lib.js';

const MAX_ROWS = 5000;

export async function onRequestGet({ env }) {
  try {
    const { rows } = await sb(env).select('site_content', {
      columns: 'key,value_en,value_zh',
      order: 'key.asc',
      limit: MAX_ROWS,
    });
    const overrides = {};
    for (const r of rows) {
      const entry = {};
      if (r.value_en !== null && r.value_en !== undefined) entry.en = r.value_en;
      if (r.value_zh !== null && r.value_zh !== undefined) entry.zh = r.value_zh;
      if (Object.keys(entry).length) overrides[r.key] = entry;
    }
    return json({ overrides }, 200, { 'cache-control': 'public, max-age=30' });
  } catch (e) {
    return bad(e.message, 500);
  }
}
