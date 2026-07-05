-- ============================================================================
--  provision-month-function.sql — the SINGLE SOURCE OF TRUTH for provisioning
--  a new monthly roster table.
--
--  WHY A FUNCTION: PostgREST (the supabase-js client / the browser anon key)
--  can only do row CRUD — it cannot run DDL like CREATE TABLE / GRANT / CREATE
--  POLICY. Wrapping the whole provisioning routine in a SECURITY DEFINER
--  function lets the monthly GitHub Actions workflow provision the next month
--  with a single supabase.rpc('provision_month', ...) call (service_role key),
--  while the manual path (scripts/provision-month.sql) calls the exact same
--  function — so the two can never drift apart, which is what caused the
--  missing-anon-grant outage this function's assertion now guards against.
--
--  HOW TO INSTALL (run once, and re-run any time you change the logic — the
--  CREATE OR REPLACE makes that safe):
--    Paste this whole file into Supabase Dashboard → SQL Editor → Run.
--
--  WHAT IT DOES for provision_month(p_new, p_old):
--    1. Validates both keys look like a BE-year YYYY_MM (2400–2700 / 01–12).
--    2. No-ops (RAISE NOTICE + return) if p_new already exists — safe to run
--       twice (e.g. a manual run followed by the scheduled run).
--    3. Copies structure from p_old (LIKE ... INCLUDING ALL — columns, indexes,
--       constraints, defaults; NOT rows and NOT RLS policies).
--    4. Grants service_role full CRUD on the new table.
--    5. Copies the physician ROSTER only (prefix, firstname, lastname,
--       department) — score / submitted_at stay NULL, since nobody has
--       submitted for the new month yet.
--    6. The CREATE TABLE in step 3 already fired trg_secure_new_roster
--       (security-rls-auth.sql), which enables RLS, creates the
--       "verified read roster" policy (authenticated + is_current_user_
--       allowlisted()), and grants `authenticated` SELECT on exactly the 4
--       columns the LIFF pages read. This step re-asserts that shape rather
--       than re-deriving it, so this function can never drift back to the
--       older anon-open policy that security-rls-auth.sql retired.
--    7. HARD-ASSERTS that `authenticated` ended up with all 4 column grants
--       and that no anon-readable policy exists on the table (the check that
--       a missing grant would otherwise fail silently as a browser 401, or a
--       reintroduced anon policy would fail silently as a data leak), and
--       returns a human-readable summary string.
-- ============================================================================

create or replace function public.provision_month(p_new text, p_old text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_cols   int;
  n_rows   bigint;
begin
  -- 1. Validate identifiers before interpolating them into dynamic SQL.
  if p_new !~ '^(2[4-7][0-9]{2})_(0[1-9]|1[0-2])$' then
    raise exception 'provision_month: invalid new key "%": expected YYYY_MM (BE 2400-2700, month 01-12)', p_new;
  end if;
  if p_old !~ '^(2[4-7][0-9]{2})_(0[1-9]|1[0-2])$' then
    raise exception 'provision_month: invalid old key "%": expected YYYY_MM (BE 2400-2700, month 01-12)', p_old;
  end if;

  -- 2. Idempotency — if the new table already exists, do nothing.
  if to_regclass(format('public.%I', p_new)) is not null then
    raise notice 'provision_month: table public."%" already exists — nothing to do.', p_new;
    return format('SKIPPED: public."%s" already exists.', p_new);
  end if;

  -- Source month must exist to copy from.
  if to_regclass(format('public.%I', p_old)) is null then
    raise exception 'provision_month: source table public."%" does not exist', p_old;
  end if;

  -- 3. Structure (columns/indexes/constraints/defaults — no rows, no policies).
  execute format('create table public.%I (like public.%I including all);', p_new, p_old);

  -- 4. Service_role CRUD (the automation writes scores here).
  execute format('grant select, insert, update, delete on public.%I to service_role;', p_new);

  -- 5. Roster rows only — score / submitted_at reset (left NULL).
  execute format(
    'insert into public.%I (prefix, firstname, lastname, department)
     select prefix, firstname, lastname, department from public.%I order by index;',
    p_new, p_old
  );
  get diagnostics n_rows = row_count;

  -- 6. RLS — trg_secure_new_roster (security-rls-auth.sql) already fired
  --    synchronously as part of the CREATE TABLE in step 3 and set up the
  --    authenticated-only "verified read roster" policy + column grants.
  --    Do NOT re-create an "anon read roster" policy here: RLS policies are
  --    OR'd together, so doing so would silently reopen anonymous read access
  --    on top of the authenticated-only policy on every new table — exactly
  --    the regression this comment now guards against (this function used to
  --    do that, from before security-rls-auth.sql retired anon access).
  --    Re-assert the column safety net directly instead of re-deriving it:
  execute format('alter table public.%I add column if not exists submitted_at timestamptz;', p_new);

  -- 7a. Hard check — `authenticated` must have all 4 read columns, or the
  --     LIFF pages 401.
  select count(*) into n_cols
  from information_schema.column_privileges
  where grantee = 'authenticated'
    and table_schema = 'public'
    and table_name = p_new
    and column_name in ('firstname', 'lastname', 'department', 'submitted_at');

  if n_cols <> 4 then
    raise exception
      'provision_month: authenticated read grant on public."%" is incomplete (% of 4 columns) — the LIFF pages would fail with 401. Is trg_secure_new_roster installed (security-rls-auth.sql)?',
      p_new, n_cols;
  end if;

  -- 7b. Hard check — anon must NOT have any policy on this table (RLS
  --     policies are OR'd together, so an anon policy here would silently
  --     leak every physician's roster row with no login at all).
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = p_new and 'anon' = any(roles)
  ) then
    raise exception
      'provision_month: table public."%" has an anon-visible RLS policy — this must never happen post security-rls-auth.sql',
      p_new;
  end if;

  return format('OK: provisioned public."%s" from public."%s" — %s roster rows, authenticated can read 4/4 columns, anon has zero access.',
                p_new, p_old, n_rows);
end;
$$;

-- Only the automation (service_role) may provision. Never anon/authenticated.
revoke all on function public.provision_month(text, text) from public;
grant execute on function public.provision_month(text, text) to service_role;
