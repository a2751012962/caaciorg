-- Event forms cleanup: drop what 0018 kept only for the code that was live
-- while 0018 was pasted.
--   * trigger event_registrations_sync_answers and its function, which mapped
--     old-code writes of the legacy columns into answers;
--   * function event_registration_legacy_answers, that legacy -> answers mapping;
--   * event_registrations.attending / attendee_names / heard_from / wants_meal,
--     the Mid-Autumn form's fixed columns (0015). Their values live in answers.
-- Paste ONLY while production runs the 0018 code (main 1d6e8a5 or later, live
-- on caaciorg.com since 2026-09-13), which reads and writes answers alone.
-- Code from before 1d6e8a5 writes these columns and could no longer save a
-- registration, so never roll production back past 1d6e8a5 after this.
-- The guard runs first and stops the paste before anything is dropped if a
-- registration still has legacy values but empty answers, which would be lost.
-- (Checked read-only on 2026-09-13: 4 registrations, every one with answers
-- equal to the mapping of its legacy values.)
-- Idempotent (the guard skips once the columns are gone; drop ... if exists), so
-- pasting it twice is safe.
-- Run via: paste into the Supabase SQL editor (never supabase db push on this project; see SETUP.md)

do $guard$
declare
  unmapped bigint;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'event_registrations'
      and column_name = 'attending'
  ) then
    execute $q$
      select count(*) from public.event_registrations
      where answers = '{}'::jsonb
        and (attending is not null or nullif(btrim(attendee_names), '') is not null
             or nullif(btrim(heard_from), '') is not null or wants_meal is not null)
    $q$ into unmapped;
    if unmapped > 0 then
      raise exception '0019 stopped: % registration(s) have legacy values but empty answers; nothing was dropped', unmapped;
    end if;
  end if;
end
$guard$;

-- The trigger before its function, which it depends on.
drop trigger if exists event_registrations_sync_answers on public.event_registrations;
drop function if exists public.event_registrations_sync_answers();
drop function if exists public.event_registration_legacy_answers(boolean, text, text, boolean);

alter table public.event_registrations drop column if exists attending;
alter table public.event_registrations drop column if exists attendee_names;
alter table public.event_registrations drop column if exists heard_from;
alter table public.event_registrations drop column if exists wants_meal;
