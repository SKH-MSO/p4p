-- ============================================================================
--  P4P — Supabase Row Level Security lockdown
-- ============================================================================
--  Context
--  -------
--  The web pages (status / list / ranking) talk to Supabase directly from the
--  browser using the PUBLIC publishable (anon) key. That key is meant to be
--  public — the ONLY thing protecting the data is Row Level Security (RLS).
--  With RLS disabled, anyone who views page source can read every column and
--  INSERT / UPDATE / DELETE rows via the auto-generated PostgREST API.
--
--  What the pages actually need (read-only):
--    ranking -> p4p_submissions : physician_name, department, work_month, submitted_at
--    status  -> <YYYY_MM> roster : firstname, lastname, department
--    list    -> <YYYY_MM> roster : firstname, lastname, department
--
--  This script enables RLS, allows anon to READ ONLY those columns, and blocks
--  all anonymous writes/deletes. Writes must use the service_role key, which
--  bypasses RLS.
--
--  How to run
--  ----------
--  1. Deploy the front-end change first (status must select explicit columns,
--     not "*", or it will break under the column grants). Commit 07eb53b.
--  2. Run Block 1 + Block 2 below in the Supabase SQL Editor.
--  3. Block 3 is optional (auto-secures future monthly tables).
--  All blocks are idempotent — safe to re-run.
--
--  Verify (should DENY *, allow the listed columns, DENY writes):
--    curl '.../rest/v1/p4p_submissions?select=*'                              -H "apikey:<pub>"   # error
--    curl '.../rest/v1/p4p_submissions?select=physician_name,department'      -H "apikey:<pub>"   # ok
--    curl '.../rest/v1/2569_06?select=score'                                  -H "apikey:<pub>"   # error
--    curl '.../rest/v1/2569_06?select=firstname,lastname,department'          -H "apikey:<pub>"   # ok
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Block 1 — ranking : p4p_submissions
-- ----------------------------------------------------------------------------
alter table public.p4p_submissions enable row level security;

drop policy if exists "anon read submissions" on public.p4p_submissions;
create policy "anon read submissions"
  on public.p4p_submissions for select to anon using (true);

revoke all on public.p4p_submissions from anon;
grant select (physician_name, department, work_month, submitted_at)
  on public.p4p_submissions to anon;


-- ----------------------------------------------------------------------------
-- Block 2 — status + list : every monthly roster table named YYYY_MM
--           (e.g. 2569_04, 2569_05, ...). Applies to all existing tables.
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
    execute format('create policy "anon read roster" on public.%I for select to anon using (true);', t);
    execute format('revoke all on public.%I from anon;', t);
    execute format('grant select (firstname, lastname, department) on public.%I to anon;', t);
  end loop;
end $$;


-- ----------------------------------------------------------------------------
-- Block 3 — OPTIONAL : auto-secure every NEW YYYY_MM table on creation, so a
--           freshly imported monthly roster is locked down automatically.
--           Requires the table to have firstname/lastname/department at create
--           time (e.g. CSV import). The exception handler keeps a failure from
--           blocking table creation — just re-run Block 2 if that happens.
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
        execute format('drop policy if exists "anon read roster" on public.%I;', nm);
        execute format('create policy "anon read roster" on public.%I for select to anon using (true);', nm);
        execute format('revoke all on public.%I from anon;', nm);
        execute format('grant select (firstname, lastname, department) on public.%I to anon;', nm);
      exception when others then
        raise warning 'secure_new_roster failed for %: %', nm, sqlerrm;
      end;
    end if;
  end loop;
end $$;

drop event trigger if exists trg_secure_new_roster;
create event trigger trg_secure_new_roster on ddl_command_end
  when tag in ('CREATE TABLE') execute function public.secure_new_roster();
