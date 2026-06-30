-- ============================================================================
--  provision-month.sql — create a new monthly roster table from last month's
--
--  WHY: Each month needs a fresh "YYYY_MM" roster table (Buddhist year, e.g.
--  "2569_07" for July 2026). The table holds the same physicians as last
--  month, but with score + submitted_at reset to NULL since nobody has
--  submitted P4P for the new month yet.
--
--  HOW TO USE
--    1. Find/replace the two placeholders below (case-sensitive):
--         {{NEW}}  → the month you are creating, e.g. 2569_07
--         {{OLD}}  → the previous month to copy from, e.g. 2569_06
--    2. Paste the whole file into Supabase Dashboard → SQL Editor → Run.
--
--  Safe to re-run: CREATE TABLE will simply fail with "already exists" if
--  {{NEW}} was already provisioned — nothing here overwrites existing data.
--  Steps 2 and 4 are otherwise idempotent.
-- ============================================================================

-- 1. Structure — copy columns/indexes/constraints from {{OLD}} (no data yet)
CREATE TABLE public."{{NEW}}" (LIKE public."{{OLD}}" INCLUDING ALL);

-- 2. Grant the automation (service_role) full CRUD on the new table.
--    (ALTER DEFAULT PRIVILEGES in fix-supabase-grants.sql should also cover
--    this automatically — this line just guarantees it.)
GRANT SELECT, INSERT, UPDATE, DELETE ON public."{{NEW}}" TO service_role;

-- 3. Content — copy the physician roster only (NOT {{OLD}}'s score/
--    submitted_at, since nobody has submitted for {{NEW}} yet).
INSERT INTO public."{{NEW}}" (prefix, firstname, lastname, department)
SELECT prefix, firstname, lastname, department
FROM public."{{OLD}}"
ORDER BY index;

-- 4. RLS — same anon read-only policy as every other month table.
--    (trg_secure_new_roster in security-rls.sql should auto-apply this on
--    CREATE TABLE already — running it again here is harmless and
--    guarantees it either way.)
ALTER TABLE public."{{NEW}}" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."{{NEW}}" ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
DROP POLICY IF EXISTS "anon read roster" ON public."{{NEW}}";
CREATE POLICY "anon read roster" ON public."{{NEW}}" FOR SELECT TO anon USING (true);
REVOKE ALL ON public."{{NEW}}" FROM anon;
GRANT SELECT (firstname, lastname, department, submitted_at) ON public."{{NEW}}" TO anon;

-- 5. Verify
SELECT count(*) AS roster_count FROM public."{{NEW}}";

SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename = '{{NEW}}';

SELECT grantee, string_agg(privilege_type, ', ') AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = '{{NEW}}'
GROUP BY grantee;
