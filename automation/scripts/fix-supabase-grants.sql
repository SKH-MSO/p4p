-- ============================================================================
-- fix-supabase-grants.sql   (SECURITY-HARDENED)
--
-- Fixes (and PERMANENTLY prevents) the recurring
--   "permission denied for table <month>"
-- error that blocks P4P score saving and submission logging — WITHOUT handing
-- the public anon key any write access.
--
-- ROOT CAUSE
--   Each month a new score table (e.g. "2569_06") is created. In Postgres a
--   freshly created table grants NOTHING to the API roles unless privileges are
--   granted explicitly OR default privileges were configured ahead of time.
--   The automation writes with the SERVICE_ROLE key, so service_role is the
--   only role that needs INSERT/UPDATE/DELETE.
--
-- ⚠️  PREVIOUS VERSION OF THIS SCRIPT WAS UNSAFE
--   It granted SELECT, INSERT, UPDATE, DELETE on ALL tables (and via default
--   privileges, all FUTURE tables) to anon + authenticated. The browser pages
--   use the PUBLIC publishable (anon) key, so that gave anyone who views page
--   source full read/write/delete on every table — gated only by RLS. It also
--   let anon read columns the pages never need (e.g. score). PART 2 below
--   REVOKES those grants. Run this whole file to undo the exposure.
--
-- THE CORRECT MODEL
--   • service_role  → full CRUD (bypasses RLS); the automation uses this key.
--   • anon          → SELECT on specific columns only, via RLS policies in
--                     scripts/security-rls.sql. No table-wide grants.
--   • authenticated → nothing (the app has no logged-in users).
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste → Run. Then run
--   scripts/security-rls.sql to (re)assert RLS + the column-restricted anon
--   SELECT policies. Both are idempotent.
-- ============================================================================


-- ── PART 1 — service_role gets full CRUD on everything that exists now ───────
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO service_role;

GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO service_role;


-- ── PART 2 — REVOKE the unsafe anon / authenticated grants ──────────────────
-- Undo what the previous version of this script handed to the public key.
-- security-rls.sql re-grants anon SELECT on ONLY the public columns, per table.
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE SELECT                ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL                   ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;


-- ── PART 3 — default privileges for FUTURE tables: service_role ONLY ────────
-- Tables made through the dashboard / SQL editor are created by "postgres".
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
  TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES
  TO service_role;

-- Remove any default-privilege rule a previous run registered for anon/auth,
-- so future monthly tables never auto-grant the public key.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES
  FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES
  FROM anon, authenticated;


-- ── PART 4 — verification ───────────────────────────────────────────────────
-- 4a. anon / authenticated must show NO INSERT/UPDATE/DELETE on any table, and
--     SELECT only where security-rls.sql granted specific columns.
SELECT table_name, grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;

-- 4b. Confirm the default-privilege rules (service_role only).
SELECT pg_get_userbyid(d.defaclrole) AS owner_role,
       n.nspname                     AS schema,
       d.defaclacl                   AS default_acl
FROM pg_default_acl d
JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE n.nspname = 'public';

-- 4c. Confirm RLS is ENABLED on every roster table + p4p_submissions.
--     rowsecurity must be true for all. If any is false, run security-rls.sql.
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND (tablename ~ '^[0-9]{4}_[0-9]{2}$' OR tablename = 'p4p_submissions')
ORDER BY tablename;


-- ============================================================================
-- PART 5 — MONTHLY PROVISIONING (run this each month instead of dashboard
--          "Duplicate table")
--
-- WHY: Postgres never copies GRANTs when a table is duplicated. PART 3 above
--      auto-grants service_role on new tables, but this explicit snippet
--      GUARANTEES it and keeps the public key out.
--
-- HOW TO USE each month — replace the two month keys, then run:
--   • NEW = the month you are creating   (e.g. 2569_07)
--   • OLD = the previous month to copy   (e.g. 2569_06)
-- ============================================================================
--
--   -- 1. Create the new month from the previous month's structure.
--   CREATE TABLE public."2569_07" (LIKE public."2569_06" INCLUDING ALL);
--
--   -- 2. Grant the automation (service_role) only. Do NOT grant anon here —
--   --    anon's column-restricted SELECT comes from security-rls.sql / the
--   --    secure_new_roster event trigger.
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public."2569_07" TO service_role;
--
--   -- 3. Run scripts/security-rls.sql (or rely on the secure_new_roster event
--   --    trigger) to enable RLS + grant anon SELECT on the public columns only.
--
--   -- 4. Import the roster CSV with the "append / insert rows" option.
--   --    Do NOT use an import that DROPS and RECREATES the table.
--
-- ============================================================================
