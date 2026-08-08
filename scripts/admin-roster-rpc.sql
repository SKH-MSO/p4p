-- ============================================================================
--  admin-roster-rpc.sql — table/column discovery for the /admin/ roster
--  CRUD dashboard (main.js "/admin/api/*" routes).
--
--  These two functions let the server discover which public.YYYY_MM roster
--  tables exist and what columns each one has, WITHOUT hardcoding table
--  names (new months keep working automatically once provision_month() adds
--  them) and without exposing information_schema directly over PostgREST
--  (it isn't in the exposed schema list, and shouldn't be).
--
--  service_role-only, same posture as dept_heads / physician_directory:
--  "no anon/authenticated policies — only service_role". The admin API
--  routes in main.js call these using SUPABASE_SERVICE_ROLE_KEY, which never
--  reaches the browser — the browser only ever talks to our own /admin/api/*.
--
--  No dynamic SQL / string interpolation in either function — p_table is
--  used only as a bind parameter in a plain `where` clause, so there is no
--  injection surface even though it's caller-influenced.
-- ============================================================================

create or replace function public.admin_list_roster_tables()
returns text[]
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(array_agg(table_name order by table_name), array[]::text[])
  from information_schema.tables
  where table_schema = 'public'
    and table_type = 'BASE TABLE'
    and table_name ~ '^[0-9]{4}_[0-9]{2}$';
$$;

revoke all on function public.admin_list_roster_tables() from public;
revoke all on function public.admin_list_roster_tables() from anon;
revoke all on function public.admin_list_roster_tables() from authenticated;
grant execute on function public.admin_list_roster_tables() to service_role;

create or replace function public.admin_table_columns(p_table text)
returns table (column_name text, data_type text, is_pk boolean)
language sql
security definer
stable
set search_path = public
as $$
  select c.column_name, c.data_type,
         exists (
           select 1
           from information_schema.table_constraints tc
           join information_schema.key_column_usage k
             on k.constraint_name = tc.constraint_name
            and k.table_schema = tc.table_schema
           where tc.table_schema = 'public'
             and tc.table_name = p_table
             and tc.constraint_type = 'PRIMARY KEY'
             and k.column_name = c.column_name
         ) as is_pk
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table
    and p_table ~ '^[0-9]{4}_[0-9]{2}$'
  order by c.ordinal_position;
$$;

revoke all on function public.admin_table_columns(text) from public;
revoke all on function public.admin_table_columns(text) from anon;
revoke all on function public.admin_table_columns(text) from authenticated;
grant execute on function public.admin_table_columns(text) to service_role;
