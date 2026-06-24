-- ============================================================================
--  P4P — Enable write access via PostgREST API (anon key)
-- ============================================================================
--  Run AFTER scripts/security-rls.sql (which sets up RLS and base grants).
--  Idempotent — safe to re-run.
--
--  What this adds
--  --------------
--  1. anon can INSERT rows into p4p_submissions
--     (required fields: physician_name, department, work_month)
--
--  2. anon can UPDATE submitted_at on every YYYY_MM roster table
--     (set to a timestamptz when a submission is processed; set to NULL
--      to clear/undo)
--
--  3. The secure_new_roster() event trigger is updated so future monthly
--     tables automatically get the same write grants on creation.
--
--  NOTE: security-rls.sql runs "revoke all … from anon" before its grants.
--  If you re-run that script after this one, re-run this script too to
--  restore the write grants.
--
--  Verify (after running):
--    # INSERT — should succeed:
--    curl -X POST '.../rest/v1/p4p_submissions' \
--      -H "apikey:<anon>" -H "Content-Type: application/json" \
--      -d '{"physician_name":"Test Doc","department":"ER","work_month":"2569_06"}'
--
--    # UPDATE submitted_at — should succeed:
--    curl -X PATCH '.../rest/v1/2569_06?firstname=eq.สมชาย' \
--      -H "apikey:<anon>" -H "Content-Type: application/json" \
--      -d '{"submitted_at":"2025-06-15T10:00:00+07:00"}'
--
--    # UPDATE other columns — should FAIL (not granted):
--    curl -X PATCH '.../rest/v1/2569_06?firstname=eq.สมชาย' \
--      -H "apikey:<anon>" -H "Content-Type: application/json" \
--      -d '{"firstname":"Hacker"}'
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Block 1 — INSERT on p4p_submissions
-- ----------------------------------------------------------------------------
grant insert (physician_name, department, work_month, submitted_at)
  on public.p4p_submissions to anon;

drop policy if exists "anon insert submissions" on public.p4p_submissions;
create policy "anon insert submissions"
  on public.p4p_submissions for insert to anon
  with check (
    physician_name is not null
    and department  is not null
    and work_month  is not null
  );


-- ----------------------------------------------------------------------------
-- Block 2 — UPDATE submitted_at on all existing YYYY_MM roster tables
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename ~ '^[0-9]{4}_[0-9]{2}$'
  loop
    execute format('grant update (submitted_at) on public.%I to anon;', t);
    execute format('drop policy if exists "anon update submitted_at" on public.%I;', t);
    execute format(
      'create policy "anon update submitted_at" on public.%I '
      'for update to anon using (true) with check (true);',
      t
    );
  end loop;
end $$;


-- ----------------------------------------------------------------------------
-- Block 3 — Update event trigger so NEW roster tables get write grants too
-- ----------------------------------------------------------------------------
create or replace function public.secure_new_roster()
returns event_trigger language plpgsql as $$
declare r record; nm text;
begin
  for r in select objid from pg_event_trigger_ddl_commands() where command_tag = 'CREATE TABLE' loop
    select c.relname into nm
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.oid = r.objid and n.nspname = 'public';

    if nm ~ '^[0-9]{4}_[0-9]{2}$' then
      begin
        execute format('alter table public.%I enable row level security;', nm);
        execute format('alter table public.%I add column if not exists submitted_at timestamptz;', nm);

        -- read grants (same as security-rls.sql Block 3)
        execute format('revoke all on public.%I from anon;', nm);
        execute format('grant select (firstname, lastname, department, submitted_at) on public.%I to anon;', nm);
        execute format('drop policy if exists "anon read roster" on public.%I;', nm);
        execute format('create policy "anon read roster" on public.%I for select to anon using (true);', nm);

        -- write grants (new)
        execute format('grant update (submitted_at) on public.%I to anon;', nm);
        execute format('drop policy if exists "anon update submitted_at" on public.%I;', nm);
        execute format(
          'create policy "anon update submitted_at" on public.%I '
          'for update to anon using (true) with check (true);',
          nm
        );
      exception when others then
        raise warning 'secure_new_roster failed for %: %', nm, sqlerrm;
      end;
    end if;
  end loop;
end $$;
