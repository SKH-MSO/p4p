-- ============================================================================
--  cleanup-stale-policies.sql — drop legacy permissive RLS policies left over
--  on the older monthly roster tables.
--
--  Context
--  -------
--  Every YYYY_MM roster table should carry exactly one RLS policy:
--    "anon read roster"  (SELECT, to anon, using true)
--  as created by scripts/security-rls.sql / scripts/provision-month.sql.
--
--  2568_09 through 2569_06 additionally carry two leftover policies that
--  predate the RLS lockdown process:
--    "ALL"                (ALL commands, to public, using true)
--    "anon full access"   (ALL commands, to anon,   using true)
--
--  These never got cleaned up because security-rls.sql only manages the
--  "anon read roster" policy by name (drop-if-exists + recreate) — it never
--  audited other stray policies. 2569_07 doesn't have them because it was
--  created via `CREATE TABLE ... LIKE ... INCLUDING ALL`, which copies
--  structure but never RLS policies in Postgres.
--
--  They are not currently exploitable — anon and public hold no table-level
--  GRANTs on these tables, only anon's column-level SELECT — but they are
--  latent risk: any future GRANT to anon/public on these tables (dashboard
--  toggle, script, migration) would instantly reactivate full anonymous
--  read/write/delete via these policies. This script removes the dead code
--  so every roster table matches 2569_07's clean state.
--
--  Safe to re-run: DROP POLICY IF EXISTS is a no-op once the policy is gone.
-- ============================================================================

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename ~ '^[0-9]{4}_[0-9]{2}$'
  loop
    execute format('drop policy if exists "ALL" on public.%I;', t);
    execute format('drop policy if exists "anon full access" on public.%I;', t);
  end loop;
end $$;

-- Verify: every roster table should now show exactly "anon read roster".
select schemaname, tablename, policyname, permissive, roles, cmd, qual
from pg_policies
where tablename ~ '^[0-9]{4}_[0-9]{2}$'
order by tablename, policyname;
