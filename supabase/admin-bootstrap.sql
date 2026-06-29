-- ============================================================
-- CAACI — one-time admin account bootstrap
-- ============================================================
-- Creates a login user in Supabase Auth (auth.users) AND flips the
-- matching public.members row to is_admin = true, so the account can
-- sign in at /login-3/ and reach the /admin/ panel.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- (Do NOT put this in migrations/ — it carries a credential and is a
--  one-off. Run it once, then you can delete this file.)
--
-- AFTER RUNNING: log in with the email + password below, then CHANGE
-- the password from /account/ (or reset it from the login page).
--
-- To use a different email/password, edit the two values in the DO
-- block below before running. Safe to re-run: it won't duplicate the
-- user, and it re-asserts is_admin.
-- ============================================================

create extension if not exists pgcrypto;

do $$
declare
  v_email text := 'admin@caaciorg.com';
  v_password text := 'PASTE_PASSWORD_HERE';   -- <-- replace before running (see the credential sent separately)
  v_name  text := 'CAACI Admin';
  v_id    uuid;
begin
  -- 1) Reuse the user if it already exists, else create it in auth.users.
  select id into v_id from auth.users where email = v_email;

  if v_id is null then
    v_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_id, 'authenticated', 'authenticated', v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_name),
      now(), now(),
      '', '', '', ''
    );

    -- Email identity (required for email/password sign-in).
    insert into auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      v_id, v_id,
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  else
    -- User exists: (re)set the password and confirm the email.
    update auth.users
       set encrypted_password = crypt(v_password, gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = v_id;
  end if;

  -- 2) Ensure the public.members row exists (the on_auth_user_created
  --    trigger normally makes it; this covers the manual-insert case)…
  insert into public.members (id, email, full_name, is_admin, status)
  values (v_id, v_email, v_name, true, 'active')
  on conflict (id) do update
    set is_admin = true,
        email    = excluded.email;

  raise notice 'Admin ready: % (id %)', v_email, v_id;
end $$;

-- Verify:
-- select id, email, is_admin, status from public.members where is_admin;
