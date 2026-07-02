-- ============================================================================
--  P4P — email_sent_log setup
-- ============================================================================
--  Backs the dedup/audit logic in automation/scripts/score-tracker.mjs:
--  before sending a department's monthly score report, the script checks this
--  table for an existing (table_name, department) row and skips the send if
--  found; after a successful send it upserts a row so retried/re-triggered
--  runs never duplicate the email.
--
--  Run once in the Supabase SQL editor.
-- ============================================================================

-- Required by the upsert's onConflict: "table_name,department".
alter table public.email_sent_log
  add constraint email_sent_log_table_dept_uniq unique (table_name, department);

-- Nothing client-side reads this table — lock it down like p4p_submissions,
-- minus the anon read grant. Only the automation's service_role key (which
-- bypasses RLS) touches it.
alter table public.email_sent_log enable row level security;
revoke all on public.email_sent_log from anon;
