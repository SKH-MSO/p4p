-- ============================================================================
--  P4P — sk03_run_log setup
-- ============================================================================
--  Backs the dedup/audit logic in process/process.js: before merging Excel
--  files and creating the SK03 spreadsheet for a month, the script checks
--  this table for an existing row and skips Steps 5/6 if found; after a
--  successful run it upserts a row so the daily cron (or a manual re-run)
--  never regenerates the same month's merged file / SK03 spreadsheet twice.
--
--  Run once in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.sk03_run_log (
  table_name           text primary key,      -- month key, e.g. "2569_04"
  run_at               timestamptz not null default now(),
  merged_file_id       text,                   -- Drive file ID of merged_<month>.xlsx
  sk03_spreadsheet_id  text                    -- Drive file ID of the SK03 spreadsheet
);

-- Nothing client-side reads this table — lock it down like email_sent_log.
-- Only the automation's service_role key (which bypasses RLS) touches it.
alter table public.sk03_run_log enable row level security;
revoke all on public.sk03_run_log from anon;
