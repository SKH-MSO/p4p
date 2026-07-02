-- ============================================================================
--  P4P — RLS upgrade: anon-read  ->  authenticated + allow-listed read
-- ============================================================================
--  Context
--  -------
--  scripts/security-rls.sql previously let the PUBLIC anon key READ the roster
--  tables and p4p_submissions. That made the email-verification page cosmetic:
--  anyone with the (public) anon key could query Supabase directly and read the
--  same data without ever verifying.
--
--  This script closes that hole. After it runs:
--    • the roster tables (YYYY_MM) + p4p_submissions can only be READ by an
--      AUTHENTICATED session whose email is present in sender_physician_match;
--    • the anon role can no longer read any of that data;
--    • writes still require the service_role key (unchanged).
--
--  The front-end obtains a session via Supabase Auth email OTP on /verify/
--  (see verify/index.html + assets/auth-guard.js).
--
--  Supabase dashboard steps (do these BEFORE relying on the gate)
--  --------------------------------------------------------------
--    1. Authentication → Providers → Email: ENABLE. Turn OFF "Confirm email"
--       is not required for OTP; keep "Enable email provider" ON.
--    2. Authentication → Email Templates → "Magic Link": make sure the body
--       includes the numeric token, e.g.  {{ .Token }}  — otherwise Supabase
--       sends only a magic link and the 6-digit code box can't be used.
--    3. (Recommended) Authentication → Providers → Email: turn OFF
--       "Allow new users to sign up" if you pre-create users; otherwise leave
--       it ON — RLS below still blocks any non-allow-listed email from reading.
--    4. Configure SMTP (Authentication → SMTP) so OTP emails actually send in
--       production. The default Supabase mailer is rate-limited to a few/hour.
--
--  Rollout order
--  -------------
--    1. Do the dashboard steps above and confirm you can receive an OTP.
--    2. Deploy the front-end (verify page + auth-guard + gated pages).
--    3. Run THIS file in the Supabase SQL editor to lock reads to authenticated
--       + allow-listed. (Running it before step 2 would lock out the live site.)
--
--  Verify (with the PUBLIC key, i.e. anon — everything should now be denied):
--    curl '.../rest/v1/2569_06?select=firstname'  -H "apikey:<pub>"   # -> [] / error
--  With a valid user JWT in Authorization: Bearer <jwt>, the same query returns
--  rows only if that user's email is in sender_physician_match.
--
--  All blocks are idempotent.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Block 0 — allow-list helpers (SECURITY DEFINER so they can read
--           sender_physician_match without granting anyone SELECT on it).
-- ----------------------------------------------------------------------------

-- Used by /verify/ BEFORE login: "is this email allowed to request a code?"
-- Returns only a boolean, so the email list is never exposed to the client.
create or replace function public.is_sender_allowlisted(p_email text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.sender_physician_match m
    where lower(m.sender_email) = lower(p_email)
  );
$$;

-- Used by the RLS policies AFTER login: "is the current session's email allowed?"
create or replace function public.is_current_user_allowlisted()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.sender_physician_match m
    where lower(m.sender_email) = lower(auth.jwt() ->> 'email')
  );
$$;

revoke all on function public.is_sender_allowlisted(text) from public;
revoke all on function public.is_current_user_allowlisted() from public;
grant execute on function public.is_sender_allowlisted(text) to anon, authenticated;
grant execute on function public.is_current_user_allowlisted() to authenticated;


-- ----------------------------------------------------------------------------
-- Block 1 — p4p_submissions : authenticated + allow-listed read only
-- ----------------------------------------------------------------------------
alter table public.p4p_submissions enable row level security;

drop policy if exists "anon read submissions" on public.p4p_submissions;
drop policy if exists "verified read submissions" on public.p4p_submissions;
create policy "verified read submissions"
  on public.p4p_submissions for select to authenticated
  using (public.is_current_user_allowlisted());

revoke all on public.p4p_submissions from anon;
grant select (physician_name, department, work_month, submitted_at)
  on public.p4p_submissions to authenticated;


-- ----------------------------------------------------------------------------
-- Block 2 — every existing monthly roster table named YYYY_MM
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename ~ '^[0-9]{4}_[0-9]{2}$'
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "anon read roster" on public.%I;', t);
    execute format('drop policy if exists "verified read roster" on public.%I;', t);
    execute format('create policy "verified read roster" on public.%I for select to authenticated using (public.is_current_user_allowlisted());', t);
    execute format('revoke all on public.%I from anon;', t);
    execute format('grant select (firstname, lastname, department, submitted_at) on public.%I to authenticated;', t);
  end loop;
end $$;


-- ----------------------------------------------------------------------------
-- Block 3 — auto-secure every NEW YYYY_MM table on creation, using the same
--           authenticated + allow-listed policy as Block 2.
-- ----------------------------------------------------------------------------
create or replace function public.secure_new_roster()
returns event_trigger language plpgsql as $$
declare r record; nm text;
begin
  for r in select objid from pg_event_trigger_ddl_commands() where command_tag = 'CREATE TABLE' loop
    select c.relname into nm from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.oid = r.objid and n.nspname = 'public';
    if nm ~ '^[0-9]{4}_[0-9]{2}$' then
      begin
        execute format('alter table public.%I enable row level security;', nm);
        execute format('alter table public.%I add column if not exists submitted_at timestamptz;', nm);
        execute format('drop policy if exists "anon read roster" on public.%I;', nm);
        execute format('drop policy if exists "verified read roster" on public.%I;', nm);
        execute format('create policy "verified read roster" on public.%I for select to authenticated using (public.is_current_user_allowlisted());', nm);
        execute format('revoke all on public.%I from anon;', nm);
        execute format('grant select (firstname, lastname, department, submitted_at) on public.%I to authenticated;', nm);
      exception when others then
        raise warning 'secure_new_roster failed for %: %', nm, sqlerrm;
      end;
    end if;
  end loop;
end $$;

drop event trigger if exists trg_secure_new_roster;
create event trigger trg_secure_new_roster on ddl_command_end
  when tag in ('CREATE TABLE') execute function public.secure_new_roster();
