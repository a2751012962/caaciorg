-- Event forms: every event can take registrations with its own questions, and
-- can offer its own free gift. Generalizes the Mid-Autumn Festival form (0015).
--   * events.title_zh — the Chinese title, shown on the registration page and
--     in emails when set.
--   * events.registration_questions — null: the event takes no registrations
--     (no registration page; /api/event-register answers 404). An array, even
--     an empty one: the questions of an open form, in display order, in the
--     shape functions/api/_event-form.js validates.
--   * events.perk_item_zh / perk_item_en — the free gift (e.g. 月饼 / mooncake);
--     both null means no gift. Its deadline stays events.perk_deadline (null
--     means the event's start).
--   * event_registrations.answers — { questionId: answer }; see _event-form.js.
--     attending / attendee_names / heard_from / wants_meal become legacy: the
--     new code never writes them, so attending loses its not-null. They stay
--     until a later migration drops them, after this release is live, because
--     the code live when this is pasted still writes and reads them.
-- The Mid-Autumn event gets its four questions and its mooncake, and its
-- existing registrations get their answers built from the legacy columns.
-- Both backfills are guarded (questions still null / answers still '{}' on a
-- legacy row), so nothing an admin or a registrant changed is overwritten.
-- No functions and no grants: event_registrations stays server-only (0015),
-- and events keep their policies (the new columns are event details, as public
-- as the title).
-- Idempotent (if not exists / guarded updates), so pasting it twice is safe.
-- Run via: paste into the Supabase SQL editor (never supabase db push on this project; see SETUP.md)

alter table public.events add column if not exists title_zh text;
alter table public.events add column if not exists registration_questions jsonb;
alter table public.events add column if not exists perk_item_zh text;
alter table public.events add column if not exists perk_item_en text;

alter table public.event_registrations add column if not exists answers jsonb not null default '{}'::jsonb;
alter table public.event_registrations alter column attending drop not null;

-- The Mid-Autumn questions, worded as on /mid_autumn_festival_form/. Ids are
-- stable: the answers below and every later registration refer to them.
update public.events
set title_zh = coalesce(title_zh, '中秋节'),
    perk_item_zh = coalesce(perk_item_zh, '月饼'),
    perk_item_en = coalesce(perk_item_en, 'mooncake'),
    registration_questions = $questions$[
      {"id": "attending", "type": "single", "required": true,
       "label_en": "Can you attend?", "label_zh": "您能参加吗？",
       "options": [
         {"id": "yes", "label_en": "Yes, I'll be there", "label_zh": "能，我会参加"},
         {"id": "no", "label_en": "Sorry, can't make it", "label_zh": "抱歉，无法参加"}
       ], "other": false},
      {"id": "names", "type": "textarea", "required": true,
       "label_en": "What are the names of people attending?", "label_zh": "参加者的姓名是？"},
      {"id": "heard_from", "type": "single", "required": false,
       "label_en": "How did you hear about this event?", "label_zh": "您是从哪里得知本次活动的？",
       "options": [
         {"id": "website", "label_en": "Website", "label_zh": "网站"},
         {"id": "friend", "label_en": "Friend", "label_zh": "朋友"},
         {"id": "newsletter", "label_en": "Newsletter", "label_zh": "简报"},
         {"id": "social", "label_en": "Social Media", "label_zh": "社交媒体"}
       ], "other": true},
      {"id": "meal", "type": "single", "required": false,
       "label_en": "Would you like to purchase a meal?", "label_zh": "您想购买餐食吗？",
       "options": [
         {"id": "yes", "label_en": "Yes", "label_zh": "是"},
         {"id": "no", "label_en": "No", "label_zh": "否"}
       ], "other": false}
    ]$questions$::jsonb
where slug = 'mid-autumn-festival'
  and registration_questions is null;

-- Legacy columns -> answers, for rows the old code wrote (attending is never
-- null there) that have no answers yet. heard_from held the fixed English
-- label or, for Other, whatever was typed ('Other' when nothing was); a blank
-- name list or an unanswered meal question is left out, as the new code would.
update public.event_registrations r
set answers = jsonb_strip_nulls(jsonb_build_object(
      'attending', jsonb_build_object('option', case when r.attending then 'yes' else 'no' end),
      'names', nullif(btrim(r.attendee_names), ''),
      'heard_from', case
        when r.heard_from is null or btrim(r.heard_from) = '' then null
        when r.heard_from = 'Website' then jsonb_build_object('option', 'website')
        when r.heard_from = 'Friend' then jsonb_build_object('option', 'friend')
        when r.heard_from = 'Newsletter' then jsonb_build_object('option', 'newsletter')
        when r.heard_from = 'Social Media' then jsonb_build_object('option', 'social')
        else jsonb_build_object('other', r.heard_from)
      end,
      'meal', case
        when r.wants_meal is null then null
        else jsonb_build_object('option', case when r.wants_meal then 'yes' else 'no' end)
      end
    ))
from public.events e
where e.id = r.event_id
  and e.slug = 'mid-autumn-festival'
  and r.answers = '{}'::jsonb
  and r.attending is not null;
