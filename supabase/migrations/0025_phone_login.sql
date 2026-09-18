-- Phone sign-in. The Supabase Phone provider (Twilio) texts one-time codes; a
-- member adds their mobile number under /account/ → Account Security, and it is
-- kept on auth.users.phone (confirmed by the texted code). members.phone is
-- what the profile card and the admin panel show, so keep it in step:
--   * a new account created with a phone copies it like full_name (sign-up is
--     by email today, so this is for completeness);
--   * a mobile number added or changed later is copied onto the member row once
--     Supabase has confirmed it — never a pending, unverified one.
-- Only adds and replaces functions; deployed code keeps working before and after.

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
