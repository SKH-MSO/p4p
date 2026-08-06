-- ============================================================================
--  P4P — Security hardening, August 2026
-- ============================================================================
--  ⚠️  NOT YET APPLIED to the live project. Review, then run in the Supabase
--      SQL editor. See SECURITY_ANALYSIS.md for the evidence behind each block.
--
--  WHY THIS FILE EXISTS
--  --------------------
--  Every earlier script used the pattern:
--
--      revoke all on function public.f(...) from public;
--      grant execute on function public.f(...) to service_role;
--
--  That pattern DOES NOT WORK on Supabase. The project has:
--
--      alter default privileges in schema public
--        grant execute on functions to anon, authenticated, service_role;
--
--  so every newly created function gets an EXPLICIT `anon=X` grant.
--  `revoke ... from public` removes only the PUBLIC pseudo-role grant and
--  leaves that explicit anon grant untouched. Verified on the live project:
--  all 13 public functions are anon-executable, including provision_month()
--  and approve_access_request(), both of which the scripts believed were
--  service_role-only.
--
--  Block 1 fixes the root cause. Blocks 2-4 clean up what it let through.
--  Idempotent — safe to re-run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Block 1 — ROOT CAUSE: stop auto-granting EXECUTE on new functions to anon.
--
--   Must run as the role that owns the default-privileges entry (postgres).
--   Without this, every future `create function` re-opens the same hole and
--   Blocks 2-3 below silently regress.
--
--   NOTE: this changes only FUTURE functions. Block 2 fixes existing ones.
-- ----------------------------------------------------------------------------
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;


-- ----------------------------------------------------------------------------
-- Block 2 — Revoke EXECUTE that should never have been reachable.
--
--   These four are called ONLY by the server (Vercel, service_role) or by a
--   GitHub Action. No browser client calls them, so revoking anon +
--   authenticated breaks nothing.
--
--   provision_month           — creates a roster table + copies ~200 rows.
--                               anon-callable = unauthenticated table creation
--                               across 3,612 valid YYYY_MM keys.
--   approve/reject_access_req — writes into physician_directory, i.e. the
--                               login allow-list itself.
--   rls_auto_enable           — event-trigger body, never called directly.
-- ----------------------------------------------------------------------------
revoke execute on function public.provision_month(text, text)   from anon, authenticated;
revoke execute on function public.approve_access_request(text)  from anon, authenticated;
revoke execute on function public.reject_access_request(text)   from anon, authenticated;
revoke execute on function public.rls_auto_enable()             from anon, authenticated;

-- Called by main.js only AFTER a valid session exists (servePage -> the gate
-- check), so `authenticated` is sufficient; the anon grant was never needed
-- and doubles as an email-enumeration oracle.
revoke execute on function public.get_line_bind_gate_status(text) from anon;

-- Trigger function — invoked by trg_notify_access_request, never by a client.
revoke execute on function public.notify_access_request() from anon, authenticated;


-- ----------------------------------------------------------------------------
-- Block 3 — Remove stale permissive policies on p4p_submissions (797 rows).
--
--   Two undocumented policies are live and are NOT in any repo script (added
--   via the dashboard). They are inert today only because anon happens to lack
--   a SELECT grant — but RLS policies are OR'd, so the moment any grant appears
--   (or the table is recreated by supabase_admin, whose default table ACL is
--   anon=arwdDxtm) they override the authenticated-only policy entirely.
-- ----------------------------------------------------------------------------
drop policy if exists "allow anon read" on public.p4p_submissions;
drop policy if exists "anon read only"  on public.p4p_submissions;

-- Belt and braces: the only policy that should remain is the allow-listed one.
do $$
declare n int;
begin
  select count(*) into n
  from pg_policies
  where schemaname = 'public' and tablename = 'p4p_submissions';
  if n <> 1 then
    raise warning 'p4p_submissions has % policies after cleanup (expected 1) — review manually', n;
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- Block 4 — Leftover table privileges from the same default-privileges leak.
--
--   anon/authenticated hold TRUNCATE (+ REFERENCES/TRIGGER) on these two.
--   Not reachable through PostgREST, but TRUNCATE ignores RLS entirely, so
--   there is no reason to leave it granted.
--
--   public.fetch is an undocumented 1-row table (id bigint, fetch text) with a
--   wide-open `ALL / public / true` policy. It appears to be an abandoned test
--   table. Confirm it is unused, then drop it — the commented-out line below.
-- ----------------------------------------------------------------------------
revoke all on public.email_sent_log from anon, authenticated;
revoke all on public."fetch"        from anon, authenticated;

-- drop table if exists public."fetch";   -- uncomment once confirmed unused


-- ----------------------------------------------------------------------------
-- Block 5 — Unguessable approve tokens.
--
--   Current default is substr(md5(random()::text || clock_timestamp()::text), 1, 12):
--   48 bits from a NON-cryptographic PRNG. pgcrypto is already installed, so
--   use it. Existing unresolved tokens are rotated too.
-- ----------------------------------------------------------------------------
alter table public.access_requests
  alter column approve_token set default encode(gen_random_bytes(16), 'hex');

update public.access_requests
  set approve_token = encode(gen_random_bytes(16), 'hex')
  where not resolved;


-- ----------------------------------------------------------------------------
-- Block 6 — Verification. All of these should come back clean.
-- ----------------------------------------------------------------------------
--  a) No public function should be anon-executable except the three the
--     /verify/ page genuinely needs pre-login:
--       is_sender_allowlisted, log_access_request, list_all_physicians
--     (list_all_physicians still leaks 250 names — see SECURITY_ANALYSIS.md
--      §2a; it needs an application change, not just a grant change.)
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by p.proname;

--  b) No anon-visible policy anywhere.
select tablename, policyname, roles::text
from pg_policies
where schemaname = 'public'
  and ('anon' = any(roles) or 'public' = any(roles));

--  c) anon must hold no table privileges at all in public.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
order by table_name, grantee;
