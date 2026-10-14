# Content management: columns, articles, page copy, editor roles

Three things an editor can change from `/admin/` without touching code:

1. **Columns and articles (专栏 / 文章).** A column directory under About
   (`/about/columns/`) and one page per article (`/about/articles/<slug>/`).
   Every article has the same fixed format (lib/articles.ts,
   components/articles/ArticleView.tsx); editors fill fields, they do not
   design pages.
2. **Page copy and photos (页面内容).** Every visible string and photo on the
   public pages lives in a data object under `web/src/data/`. Overrides saved
   in the database replace those values at load time; the code's values stay
   the defaults that "Reset" goes back to.
3. **Roles.** Developers = GitHub access (outside the site). Administrators =
   `members.is_admin`, everything. Content editors = a `content_editors` row:
   the columns they may write in (or all of them) and, separately, whether they
   may edit page copy. Editors sign in at `/admin/` and see only those tabs.

## Database — `supabase/migrations/0040_content_cms.sql`

RLS on, no policies, nothing granted to `anon` / `authenticated`: every read
and write goes through Pages Functions with the service-role key (the 0024
pattern).

```
article_columns  id uuid pk, slug text unique (^[a-z0-9]+(-[a-z0-9]+)*$),
                 name_en, name_zh, description_en, description_zh text not null default '',
                 sort_order int default 0, created_at, updated_at
articles         id uuid pk, column_id uuid not null → article_columns (on delete restrict),
                 slug text unique (same pattern), title_en, title_zh, summary_en, summary_zh,
                 body_en, body_zh, cover_alt_en, cover_alt_zh, author  text not null default '',
                 cover_url text null, status text 'draft'|'published' default 'draft',
                 published_at timestamptz null, pinned boolean default false,
                 created_by, updated_by uuid → members (on delete set null), created_at, updated_at
                 check (title_en <> '' or title_zh <> '')
content_editors  member_id uuid pk → members (on delete cascade), all_columns boolean default false,
                 column_ids uuid[] default '{}', can_edit_pages boolean default false,
                 updated_by uuid → members (set null), created_at, updated_at
site_content     key text pk (^[A-Za-z0-9_.-]+$), value_en jsonb null, value_zh jsonb null,
                 updated_by uuid → members (set null), updated_at
```

Seeded columns (rename freely): `news` 协会动态 / CAACI News, `community`
社区故事 / Community Stories, `members` 会员风采 / Member Spotlight.

## API

Public (no auth):

| Call                                                | Answer                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/articles?column=<slug>&limit=12&offset=0` | `{ columns: ArticleColumn[], rows: ArticleSummary[], total }` — published only, `pinned desc, published_at desc`. Unknown column → empty rows.          |
| `GET /api/articles?slug=<slug>`                     | `{ article: Article, column: ArticleColumn, prev: ArticleSummary \| null, next: … }` (prev = older, next = newer, same column). Draft or missing → 404. |
| `GET /api/site-content`                             | `{ overrides: { [key]: { en?: json, zh?: json } } }` — only languages that are set.                                                                     |

Published = `status = 'published' and published_at <= now()` (a future date is
scheduled). Public answers carry `cache-control: public, max-age=30`.

Staff (Bearer token; admin, or a `content_editors` row):

| Call                                                           | Who                     | What                                                                                                                 |
| -------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/content-me`                                    | staff                   | `{ is_admin, all_columns, column_ids, can_edit_pages }`; 403 for anyone else                                         |
| `GET /api/admin/articles?column_id=&status=&q=&limit=&offset=` | staff                   | `{ rows, total }` — rows without bodies, only columns the caller may write                                           |
| `GET /api/admin/articles?id=`                                  | staff                   | `{ article }` full row                                                                                               |
| `POST /api/admin/articles`                                     | staff                   | create; body = article fields; `slug` optional (made from the English title, else a short id); answers `{ article }` |
| `PATCH /api/admin/articles`                                    | staff                   | `{ id, …fields }`; moving to another column needs both columns                                                       |
| `DELETE /api/admin/articles?id=`                               | staff                   |                                                                                                                      |
| `GET /api/admin/article-columns`                               | staff                   | `{ rows }` all columns, sort order                                                                                   |
| `POST` / `PATCH` / `DELETE ?id=` same path                     | admin                   | create / edit / delete (409 while it has articles)                                                                   |
| `GET /api/admin/content-editors`                               | admin                   | `{ rows: [{ member_id, full_name, email, all_columns, column_ids, can_edit_pages }] }`                               |
| `POST /api/admin/content-editors`                              | admin                   | `{ email, all_columns, column_ids, can_edit_pages }` upsert by the member that email belongs to                      |
| `DELETE /api/admin/content-editors?member_id=`                 | admin                   |                                                                                                                      |
| `GET /api/admin/site-content`                                  | admin or can_edit_pages | `{ rows: [{ key, value_en, value_zh, updated_at, updated_by_name }] }`                                               |
| `PUT /api/admin/site-content`                                  | admin or can_edit_pages | `{ changes: [{ key, en?: json \| null, zh?: json \| null }] }`; a key whose two values end up null is deleted        |
| `PUT /api/admin/media`                                         | staff                   | unchanged upload (editors may upload too); `GET` list staff; `DELETE` admin only                                     |

Article bodies are sanitised twice: on save (functions strip script/style/
iframe/object/embed, `on*` attributes and `javascript:` URLs) and on every
render (DOMPurify with the fixed tag set in lib/articles.ts).

## Front end

- `web/src/lib/articles.ts` — types, `pick()` language fallback, URLs, sanitiser.
- `web/src/components/articles/ArticleView.tsx` — the one article layout.
- Pages: `ColumnsPage` (`/about/columns/`, `?c=<column>` picks a column with
  FluidTabs) and `ArticlePage` (`/about/articles/<slug>/`, served by a
  `_redirects` rewrite to `/about/article/` like event registration).
- `web/src/lib/siteContent.ts` — the registry of editable data objects (EN/ZH
  pairs with the same shape), a pristine copy of the defaults, `applyOverrides()`
  (mutates the exported objects in place, so pages need no changes), boot
  loading in `main.tsx` (localStorage copy first, then `/api/site-content`,
  ≤ 800 ms wait), and the preview channel: a page opened with `?cms_preview=1`
  inside the admin's iframe takes draft overrides by `postMessage` (same
  origin only) and re-renders.

### Override keys

`<object id>.<path>` — e.g. `about.missionText`, `common.hero.title`. A string
leaf is overridden on its own; an **array is overridden as a whole**
(`about.team` → the full JSON array), so editors can add, remove and reorder
board members, and no key ever points inside an array. Values are JSON:
a string for a leaf, an array for a list.

### Rules for page copy in data files

- Everything a visitor can read on a public page — headings, paragraphs,
  buttons, labels, empty and error messages — comes from the page's data
  object, not from `lang === 'en' ? … : …` in a component.
- EN and ZH objects have identical shapes (same keys, same array lengths).
- Copy with a value in it is a template: `'{count} events'` + `fill()` from
  `web/src/lib/text.ts`.
- A photo is a string field whose name ends in `Image` (`heroImage`,
  `teamImage`) holding `/images/…` or an https URL. The Page content tab shows
  an image picker for those.
- Out of scope: the member area (account, wallet, charge, merchant, pay,
  token admin) and the admin console — functional screens, not page copy.
