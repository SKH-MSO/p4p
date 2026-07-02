-- ============================================================================
--  P4P — OPTIONAL: enforce the allow-list at SIGN-UP, server-side
-- ============================================================================
--  ⚠️  VERIFY BEFORE ENABLING. This is a TEMPLATE, not a tested migration.
--      The Supabase "Before User Created" auth hook API has changed across
--      versions; confirm the exact event shape and rejection format against the
--      CURRENT Supabase docs for your project, then test on a staging project
--      before enabling in production. Do NOT paste this into production blind.
--
--  Why this exists
--  ---------------
--  RLS (security-rls-auth.sql) already makes DATA safe: a session for a
--  non-allow-listed email can read nothing. But the /verify/ allow-list check
--  runs in client JS, so anyone with the public anon key can bypass it and call
--  auth.signInWithOtp({ email, shouldCreateUser: true }) directly for ANY
--  address. That doesn't leak data, but it lets an attacker:
--    • send OTP emails to arbitrary victims (email spam), and
--    • create junk rows in auth.users (account-table pollution).
--
--  A "Before User Created" hook rejects creation of any user whose email is not
--  allow-listed, closing both — the allow-list becomes server-enforced, not just
--  a client-side courtesy. It reuses public.is_sender_allowlisted() (defined in
--  security-rls-auth.sql), so the policy stays in ONE place.
--
--  How to enable (confirm each step against current Supabase docs)
--  ---------------------------------------------------------------
--    1. Run this file to create the function.
--    2. Dashboard → Authentication → Hooks → "Before User Created": point it at
--       public.restrict_signups_to_allowlist.
--    3. Test: an allow-listed email can still verify; a random email's OTP/signup
--       is rejected.
--
--  NOTE ON SHAPE: as of writing, the hook receives a jsonb payload with the new
--  user under `event -> 'user' -> 'email'` (nested under 'claims' or 'user'
--  depending on version) and BLOCKS creation when the function returns an
--  `error` object. Adjust the two marked lines if your version differs. Keep the
--  SECURITY DEFINER + locked search_path.
-- ============================================================================

create or replace function public.restrict_signups_to_allowlist(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  -- ▼▼ ADJUST to match your Supabase hook payload shape ▼▼
  v_email := event -> 'user' ->> 'email';
  -- ▲▲ ------------------------------------------------- ▲▲

  if v_email is null or not public.is_sender_allowlisted(v_email) then
    -- ▼▼ ADJUST to match your Supabase hook rejection format ▼▼
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'This email is not authorised for P4P access.'
      )
    );
    -- ▲▲ ------------------------------------------------------ ▲▲
  end if;

  -- Allow creation to proceed.
  return '{}'::jsonb;
end;
$$;

-- The auth hook runs as the supabase_auth_admin role; grant it execute.
revoke all on function public.restrict_signups_to_allowlist(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.restrict_signups_to_allowlist(jsonb) to supabase_auth_admin';
  end if;
end $$;
