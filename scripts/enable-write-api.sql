-- ============================================================================
--  P4P — Full access on all YYYY_MM roster tables via PostgREST API (anon key)
-- ============================================================================
--  Grants SELECT, INSERT, UPDATE, DELETE on ALL columns of every roster table
--  to the anon role. RLS stays enabled with permissive allow-all policies so
--  PostgREST enforces them correctly.
--  Idempotent — safe to re-run.
--
--  NOTE: security-rls.sql runs "revoke all … from anon" before its column
--  grants. If you re-run that script after this one, re-run this script too.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Block 1 — Full access on all existing YYYY_MM roster tables
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename ~ '^[0-9]{4}_[0-9]{2}$'
  loop
    execute format('revoke all on public.%I from anon;', t);
    execute format('grant all on public.%I to anon;', t);

    execute format('drop policy if exists "anon read roster" on public.%I;', t);
    execute format('drop policy if exists "anon update submitted_at" on public.%I;', t);
    execute format('drop policy if exists "anon full access" on public.%I;', t);
    execute format(
      'create policy "anon full access" on public.%I '
      'for all to anon using (true) with check (true);',
      t
    );
  end loop;
end $$;


-- ----------------------------------------------------------------------------
-- Block 2 — Update event trigger so NEW roster tables get full access too
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
        execute format('revoke all on public.%I from anon;', nm);
        execute format('grant all on public.%I to anon;', nm);
        execute format('drop policy if exists "anon full access" on public.%I;', nm);
        execute format(
          'create policy "anon full access" on public.%I '
          'for all to anon using (true) with check (true);',
          nm
        );
      exception when others then
        raise warning 'secure_new_roster failed for %: %', nm, sqlerrm;
      end;
    end if;
  end loop;
end $$;
