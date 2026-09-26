-- 0035 — volunteer sign-up forms with their own questions, and form templates.
--
-- The volunteer dialog asked the same five "areas of interest" and four
-- "availability" chips for every event, written into the code, and flattened
-- them into event_volunteers.message as one line of text. A festival needs to
-- ask which SHIFT someone can take and which STATION they would like, and the
-- next event asks something else again, so the questions have to be data the
-- admin edits — the shape the registration form has had since 0018.
--
--   * events.volunteer_questions — null: the event asks the site's default
--     volunteer questions (the template below). An array, even an empty one:
--     the event's own questions, in the shape functions/api/_event-form.js
--     validateQuestions accepts, exactly like events.registration_questions.
--   * event_volunteers.answers — { questionId: answer }, the same shape as
--     event_registrations.answers. A second submission for the same
--     (event, email) MERGES into it (key by key) rather than replacing it, so
--     a general sign-up made from the dialog and the event's own form filled
--     in later end up in one row. name, phone and message stay as they were.
--   * form_templates — named sets of questions an admin copies into an event
--     (or saves out of one). kind says which form they are for. At most one
--     template per kind is the default (partial unique index): the volunteer
--     default is what the dialog asks when no particular event is chosen, and
--     what an event with volunteer_questions null asks on its own page. Copy,
--     never reference: editing a template changes no event, and editing an
--     event changes no template, so stored answers keep matching their ids.
--
-- Seeded once, only when there is no volunteer template yet: the dialog's old
-- chips as the default "General volunteer" template (nothing it asked is lost),
-- and an "Event volunteer (reference)" template with the shift / station
-- questions of the Mid-Autumn Festival 2026 sign-up form, for an admin to copy
-- and re-time. Re-pasting never re-seeds and never overwrites an edit.
--
-- form_templates is read by the public /api/volunteer (the default only, with
-- the service-role key) and written by /api/admin/form-templates; like
-- event_volunteers (0021) it is server-only: RLS on with no policies and every
-- table privilege revoked from anon and authenticated.
-- Idempotent (if not exists / guarded insert / revoke), so pasting it twice is safe.
-- Run via: paste into the Supabase SQL editor (never supabase db push on this project; see SETUP.md)

alter table public.events add column if not exists volunteer_questions jsonb;

alter table public.event_volunteers
  add column if not exists answers jsonb not null default '{}'::jsonb;

create table if not exists public.form_templates (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('volunteer', 'registration')),
  name        text not null check (length(btrim(name)) between 1 and 80),
  questions   jsonb not null default '[]'::jsonb,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- one default per kind
create unique index if not exists form_templates_default
  on public.form_templates (kind) where is_default;

create index if not exists form_templates_kind on public.form_templates (kind, name);

-- ---- server-only: RLS on, no policies, no table privileges for browser roles ----
alter table public.form_templates enable row level security;
revoke all on table public.form_templates from anon, authenticated;

-- ---- seed: the dialog's old questions as the default, and the festival form as a reference ----
insert into public.form_templates (kind, name, is_default, questions)
select 'volunteer', 'General volunteer', true, $q$[
  {"id": "interests", "type": "multi", "required": false,
   "label_en": "Areas of interest", "label_zh": "感兴趣的志愿领域",
   "options": [
     {"id": "coordination", "label_en": "Event coordination", "label_zh": "活动现场协调"},
     {"id": "stage", "label_en": "Stage management", "label_zh": "舞台管理"},
     {"id": "translation", "label_en": "Translation", "label_zh": "中英翻译"},
     {"id": "design", "label_en": "Graphic design", "label_zh": "平面设计"},
     {"id": "seniors", "label_en": "Senior support", "label_zh": "长者关怀"}
   ], "other": true},
  {"id": "availability", "type": "multi", "required": false,
   "label_en": "Availability", "label_zh": "可服务时间",
   "options": [
     {"id": "weekdays", "label_en": "Weekdays", "label_zh": "工作日"},
     {"id": "weekday_evenings", "label_en": "Weekday evenings", "label_zh": "工作日晚间"},
     {"id": "weekends", "label_en": "Weekends", "label_zh": "周末"}
   ], "other": true},
  {"id": "notes", "type": "textarea", "required": false,
   "label_en": "Skills or notes", "label_zh": "专长或备注"}
]$q$::jsonb
where not exists (select 1 from public.form_templates where kind = 'volunteer');

insert into public.form_templates (kind, name, is_default, questions)
select 'volunteer', 'Event volunteer (reference)', false, $q$[
  {"id": "certificate_name", "type": "text", "required": false,
   "label_en": "Name as it should appear on your volunteer certificate",
   "label_zh": "志愿者证书上的姓名"},
  {"id": "wechat", "type": "text", "required": false,
   "label_en": "WeChat ID (optional)", "label_zh": "微信号（选填）"},
  {"id": "about_you", "type": "single", "required": true,
   "label_en": "Which best describes you?", "label_zh": "您的身份是？",
   "options": [
     {"id": "student", "label_en": "UIUC student", "label_zh": "UIUC 学生"},
     {"id": "staff", "label_en": "UIUC staff / faculty", "label_zh": "UIUC 教职员工"},
     {"id": "community", "label_en": "Community member", "label_zh": "社区成员"}
   ], "other": true},
  {"id": "shifts", "type": "multi", "required": true,
   "label_en": "When can you help?", "label_zh": "您可以帮忙的时间段？",
   "options": [
     {"id": "setup", "label_en": "12:00–2:00 PM (setup)", "label_zh": "12:00–2:00 PM（布置）"},
     {"id": "mid", "label_en": "2:00–4:30 PM", "label_zh": "2:00–4:30 PM"},
     {"id": "late", "label_en": "4:30–7:00 PM (including teardown)", "label_zh": "4:30–7:00 PM（含收尾）"},
     {"id": "full", "label_en": "The full shift, 12:00–7:00 PM", "label_zh": "全程 12:00–7:00 PM"}
   ], "other": false},
  {"id": "roles", "type": "multi", "required": true,
   "label_en": "Which roles interest you?", "label_zh": "您想负责哪些岗位？",
   "options": [
     {"id": "checkin", "label_en": "Check-in desk", "label_zh": "签到台"},
     {"id": "games", "label_en": "Game tables", "label_zh": "游戏摊位"},
     {"id": "food", "label_en": "Food street", "label_zh": "美食街"},
     {"id": "stage", "label_en": "Stage support", "label_zh": "舞台支持"},
     {"id": "art", "label_en": "Art show", "label_zh": "艺术展"},
     {"id": "setup", "label_en": "Setup & teardown", "label_zh": "布置与收尾"},
     {"id": "photo", "label_en": "Photography", "label_zh": "摄影"},
     {"id": "anywhere", "label_en": "Anywhere you need me", "label_zh": "哪里需要去哪里"}
   ], "other": false},
  {"id": "notes", "type": "textarea", "required": false,
   "label_en": "Anything else we should know?", "label_zh": "还有什么想告诉我们的？"}
]$q$::jsonb
where not exists
  (select 1 from public.form_templates where kind = 'volunteer' and name = 'Event volunteer (reference)');
