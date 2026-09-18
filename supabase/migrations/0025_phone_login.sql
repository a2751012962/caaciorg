-- Phone sign-in. The Supabase Phone provider (Twilio) texts one-time codes to
-- auth.users.phone. Nobody is asked to confirm a number (phone confirmations
-- stay off in the dashboard — the Board's call): the number typed when
-- registering becomes the account's mobile number at once, and one added later
-- under /account/ → Account Security is saved at once. The texted code at
-- sign-in is the only check. members.phone is what the profile card and the
-- admin panel show, so it is kept in step with auth.users.phone.
--   * before insert: the sign-up form puts an E.164 number in user_metadata.phone
--     (src/caaci-member.js normalises it); it is claimed as auth.users.phone
--     unless another account already has it (auth.users.phone is unique — a
--     duplicate would fail the whole sign-up);
--   * after insert: the member row copies it, like full_name;
--   * after update: a mobile number added or changed later is copied onto the
--     member row once Supabase has it confirmed (with confirmations off, at once).
-- Only adds and replaces functions; deployed code keeps working before and after.

create or replace function public.claim_signup_phone()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  wanted text := nullif(trim(new.raw_user_meta_data->>'phone'), '');
begin
  if new.phone is null
     and wanted ~ '^\+[1-9][0-9]{7,14}$'
     and not exists (select 1 from auth.users u where u.phone = ltrim(wanted, '+')) then
    -- GoTrue stores phones without the +, and compares them that way.
    new.phone := ltrim(wanted, '+');
    new.phone_confirmed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_signup_phone on auth.users;
create trigger on_auth_user_signup_phone
  before insert on auth.users
  for each row execute function public.claim_signup_phone();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.members (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    coalesce(nullif(new.raw_user_meta_data->>'phone', ''), new.phone)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.handle_user_phone_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone is not null
     and new.phone_confirmed_at is not null
     and (new.phone is distinct from old.phone or old.phone_confirmed_at is null) then
    update public.members set phone = new.phone where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_phone_change on auth.users;
create trigger on_auth_user_phone_change
  after update of phone, phone_confirmed_at on auth.users
  for each row execute function public.handle_user_phone_change();
