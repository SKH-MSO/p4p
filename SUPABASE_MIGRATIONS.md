# Supabase Migration Order

This project has no formal migration tool — every `.sql` file under
`scripts/` and `automation/sql/` is meant to be pasted into the Supabase
SQL Editor by hand. That's fine for a project this size, but it means
there's no single place that says *which files are still authoritative*
and *what order they need to run in* — which is exactly what let
`scripts/provision-month-function.sql` drift out of sync with
`scripts/security-rls-auth.sql` (see the "RLS gap" entry below). This file
is that ledger. When you add a new migration, add it here too.

Files are listed in the order they need to be run on a fresh project. All
are idempotent (`create or replace`, `create table if not exists`,
`drop policy if exists` before `create policy`, etc.) — re-running an
already-applied file is safe.

## Current, authoritative (run in this order)

1. `automation/sql/p4p_submissions.sql` — `p4p_submissions` table + RLS.
2. `automation/sql/dept_heads.sql` — `dept_heads` table + RLS.
3. `automation/sql/sender_physician_match.sql` — `sender_physician_match`
   table + RLS.
4. `automation/sql/bump_sender_match.sql` — atomic increment RPC for
   `sender_physician_match.email_count` (used by the live pipeline).
5. `scripts/security-rls-auth.sql` — **the current RLS model**: locks every
   monthly roster table (`YYYY_MM`) and `p4p_submissions` to
   `authenticated` + `is_current_user_allowlisted()`, revokes `anon`
   entirely, and installs the `trg_secure_new_roster` event trigger so any
   *future* `CREATE TABLE public."YYYY_MM"` is automatically locked down
   the same way. Also creates `physician_directory`, `access_requests`,
   `blocked_emails`, and the allow-list functions
   (`is_sender_allowlisted`, `is_current_user_allowlisted`,
   `log_access_request`).
6. `scripts/provision-month-function.sql` — `provision_month(p_new, p_old)`,
   the function `provision-next-month.mjs` calls every month to create the
   next roster table. **Must be run AFTER step 5** — it relies on
   `trg_secure_new_roster` already existing to lock down the table it
   creates, and asserts (rather than re-derives) that the resulting grants
   are `authenticated`-only with zero `anon` policies. Running this before
   step 5 would leave newly-created tables unprotected until step 5 is
   applied.
7. `scripts/list-all-physicians.sql` — `list_all_physicians()` RPC (feeds
   the `/verify/` physician-name dropdown).
8. `scripts/bind-line-user.sql` + `scripts/line-user-id-columns.sql` +
   `scripts/line-bind-gate.sql` — LINE userId binding
   (`bind_line_user_id`, `record_bind_failure`,
   `get_line_bind_gate_status`) and the `line_bind_attempts` table.
9. `scripts/line-binding-status-view.sql` — admin view of binding status.
10. `scripts/email-sent-log-setup.sql` — `email_sent_log` table + RLS
    (score-tracker dedup).
11. `scripts/telegram-approve-buttons.sql` +
    `scripts/telegram-approve-sender-display-name.sql` — Telegram
    approve/reject buttons on the access-request alert.
12. `scripts/notify-access-request.sql` and
    `scripts/auth-hook-restrict-signups.sql` — both explicitly marked
    "TEMPLATE — verify before enabling" in-file; review before running.

## Superseded — do NOT run

- **`scripts/security-rls.sql`** — the original anon-open RLS model,
  replaced by `scripts/security-rls-auth.sql` (step 5 above). Re-running it
  after step 5 would silently reopen anonymous read access on every
  roster/submissions table. Kept in the repo for history only; the file
  itself carries a large warning banner saying the same thing.
- **`scripts/backfill-submitted-at.sql`** and
  **`scripts/cleanup-stale-policies.sql`** — one-time backfill /
  cleanup scripts from the `security-rls.sql` → `security-rls-auth.sql`
  transition. Not part of a fresh-project setup; only relevant if you're
  replaying that specific historical migration.
- **`scripts/provision-month.sql`** — a thin manual wrapper that just calls
  the `provision_month()` RPC from step 6 with an explicit month key
  (for backfills). Not a separate migration; requires step 6 already
  applied.

## Known incident: the RLS gap

`scripts/provision-month-function.sql` was originally written (see commit
`949aa03`) *before* `scripts/security-rls-auth.sql` existed (`f13b898`),
back when the anon-open model (`scripts/security-rls.sql`) was still
current. Its own step 6 recreated that anon-open policy on every new
roster table. When `security-rls-auth.sql` later locked existing tables to
`authenticated`-only, `provision_month()` was never updated to match — so
every month it ran, it re-added an `anon`-visible policy on top of the
authenticated-only one (RLS policies are OR'd together), silently
reopening public read access to that month's physician roster. Fixed by
having `provision_month()` assert the `trg_secure_new_roster`-installed
shape instead of re-deriving a competing one (see the file's own header
comment). This ledger exists so the next schema change doesn't reintroduce
the same class of drift.

## Health check — catching this class of bug automatically

This exact class of regression (a roster table ending up with an
anon-visible policy alongside the authenticated-only one) is mechanically
detectable — run this in the Supabase SQL Editor at any time, or wire it
into a scheduled check, to confirm no roster table has drifted back to
anon-open:

```sql
select tablename
from pg_policies
where schemaname = 'public'
  and tablename ~ '^[0-9]{4}_[0-9]{2}$'
  and 'anon' = any(roles);
-- Expect ZERO rows. Any row returned here means that month's roster table
-- is readable by the public anon key with no login — the exact bug fixed
-- above. `provision_month()` itself now asserts this for the table it just
-- created (see scripts/provision-month-function.sql step 7b), but this
-- query checks every table, including ones provisioned before that fix.
```
