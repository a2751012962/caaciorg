-- Chinese event description: events.description_zh, shown instead of
-- events.description on the Chinese registration page and beside it in the
-- event announcement email, the way events.title_zh (0018) works for the title.
-- Null means the Chinese page shows the English description, as before.
-- The Mid-Autumn Festival gets its Chinese description. The update is guarded
-- (description_zh still null), so pasting this again never overrides an admin.
-- Paste this BEFORE deploying the code that reads description_zh: that code
-- selects the column, and PostgREST refuses a select naming a missing column.
-- Run via: paste into the Supabase SQL editor (never supabase db push on this project; see SETUP.md)

alter table public.events add column if not exists description_zh text;

update public.events
set description_zh = '在丰收的明月下，一起分享月饼。'
where slug = 'mid-autumn-festival'
  and description_zh is null;
