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
--    6. Enables RLS, (re)creates the "anon read roster" SELECT policy, revokes
--       anon's blanket access, and grants anon SELECT on exactly the 4 columns
--       the LIFF pages read.
--    7. HARD-ASSERTS that anon ended up with all 4 column grants (the check
--       that a missing grant would otherwise fail silently as a browser 401),
--       and returns a human-readable summary string.
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

  -- 6. RLS — same anon read-only shape as every other month table.
  execute format('alter table public.%I enable row level security;', p_new);
  execute format('alter table public.%I add column if not exists submitted_at timestamptz;', p_new);
  execute format('drop policy if exists "anon read roster" on public.%I;', p_new);
  execute format('create policy "anon read roster" on public.%I for select to anon using (true);', p_new);
  execute format('revoke all on public.%I from anon;', p_new);
  execute format('grant select (firstname, lastname, department, submitted_at) on public.%I to anon;', p_new);

  -- 7. Hard check — anon must have all 4 read columns, or the LIFF pages 401.
  select count(*) into n_cols
  from information_schema.column_privileges
  where grantee = 'anon'
    and table_schema = 'public'
    and table_name = p_new
    and column_name in ('firstname', 'lastname', 'department', 'submitted_at');

  if n_cols <> 4 then
    raise exception
      'provision_month: anon read grant on public."%" is incomplete (% of 4 columns) — the LIFF pages would fail with 401',
      p_new, n_cols;
  end if;

  return format('OK: provisioned public."%s" from public."%s" — %s roster rows, anon can read 4/4 columns.',
                p_new, p_old, n_rows);
end;
$$;

-- Only the automation (service_role) may provision. Never anon/authenticated.
revoke all on function public.provision_month(text, text) from public;
grant execute on function public.provision_month(text, text) to service_role;
