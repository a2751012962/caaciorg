-- 0040 — columns (专栏), articles, content editors and page-copy overrides.
--
-- Three things an editor changes from /admin/ without touching code
-- (docs/content-management.md is the contract):
--
--   * article_columns / articles — the column directory under About
--     (/about/columns/) and one page per article (/about/articles/<slug>/).
--     Every article has the same fixed layout; editors fill in fields. An
--     article is public once status = 'published' and published_at <= now(),
--     so a future published_at is a scheduled article. A column cannot be
--     deleted while articles still sit in it (on delete restrict): the API
--     answers 409 and the editor moves or deletes them first.
--   * content_editors — a non-admin who may write articles in some columns
--     (column_ids) or in all of them (all_columns), and separately may edit
--     page copy (can_edit_pages). Administrators are members.is_admin as
--     before and need no row here.
--   * site_content — overrides for the page copy and photos that live in
--     web/src/data/. key is '<object id>.<path>' (e.g. about.missionText);
--     value_en / value_zh are JSON (a string for a leaf, an array for a list),
--     null when that language keeps the code's default. The API deletes a row
--     whose two values both end up null.
--
-- updated_at is written by the Pages Functions on every change (the 0021 /
-- 0035 pattern); there is no trigger. created_by / updated_by name the
-- member who made the change and fall back to null if that member is deleted.
--
-- All four tables are server-only, like token_settings (0024): RLS on with no
-- policies and every table privilege revoked from anon and authenticated.
-- Every read and write goes through /api/articles, /api/site-content and
-- /api/admin/* with the service-role key.
--
-- Seeded once: three columns (news, community, members) that an admin renames
-- freely; re-pasting never re-seeds or overwrites an edit (on conflict do nothing).
-- Idempotent (if not exists / on conflict / revoke), so pasting it twice is safe.
-- Run via: paste into the Supabase SQL editor (never supabase db push on this project; see SETUP.md)

create table if not exists public.article_columns (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_en         text not null default '',
  name_zh         text not null default '',
  description_en  text not null default '',
  description_zh  text not null default '',
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.articles (
  id            uuid primary key default gen_random_uuid(),
  column_id     uuid not null references public.article_columns (id) on delete restrict,
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title_en      text not null default '',
  title_zh      text not null default '',
  summary_en    text not null default '',
  summary_zh    text not null default '',
  body_en       text not null default '',
  body_zh       text not null default '',
  cover_alt_en  text not null default '',
  cover_alt_zh  text not null default '',
  author        text not null default '',
  cover_url     text,
  status        text not null default 'draft' check (status in ('draft', 'published')),
  published_at  timestamptz,
  pinned        boolean not null default false,
  created_by    uuid references public.members (id) on delete set null,
  updated_by    uuid references public.members (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (title_en <> '' or title_zh <> '')
);

-- the public list (published, newest first) and a column's page
create index if not exists articles_status_published
  on public.articles (status, published_at desc);
create index if not exists articles_column on public.articles (column_id);

create table if not exists public.content_editors (
  member_id       uuid primary key references public.members (id) on delete cascade,
  all_columns     boolean not null default false,
  column_ids      uuid[] not null default '{}',
  can_edit_pages  boolean not null default false,
  updated_by      uuid references public.members (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.site_content (
  key         text primary key check (key ~ '^[A-Za-z0-9_.-]+$'),
  value_en    jsonb,
  value_zh    jsonb,
  updated_by  uuid references public.members (id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- ---- server-only: RLS on, no policies, no table privileges for browser roles ----
alter table public.article_columns enable row level security;
alter table public.articles enable row level security;
alter table public.content_editors enable row level security;
alter table public.site_content enable row level security;
revoke all on table public.article_columns from anon, authenticated;
revoke all on table public.articles from anon, authenticated;
revoke all on table public.content_editors from anon, authenticated;
revoke all on table public.site_content from anon, authenticated;

-- ---- seed: the three starting columns ----
insert into public.article_columns (slug, name_en, name_zh, sort_order)
values
  ('news', 'CAACI News', '协会动态', 10),
  ('community', 'Community Stories', '社区故事', 20),
  ('members', 'Member Spotlight', '会员风采', 30)
on conflict (slug) do nothing;
