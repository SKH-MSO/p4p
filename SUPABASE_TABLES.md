# Supabase Tables Overview

This document summarizes every Supabase table used by the P4P project, **except**
the monthly roster tables (named `YYYY_MM`, e.g. `2569_06`), which are
per-month physician rosters imported separately each month.

Migrations for these tables live in `automation/sql/` and `scripts/`.

---

## `p4p_submissions`

**Purpose:** Central log of every P4P (Pay-for-Performance) report submission a
physician has emailed in, across all months.

- **Columns:** `physician_name`, `department`, `work_month` (e.g. `2569_06`),
  `submitted_at`, `thread_id` (Gmail thread), `filename`.
- Written by `automation/supabase-client.js` (`logSubmission()`) when the
  email-processing automation successfully parses a submission. Upserts with
  `onConflict: "physician_name,work_month"` + `ignoreDuplicates: true`, so
  re-processing the same email never creates a duplicate or overwrite.
- Source of truth that each monthly roster table's `submitted_at` column is
  backfilled from (`scripts/backfill-submitted-at.sql`).
- **Access:** RLS-protected — only `authenticated` users whose email is
  allow-listed can `SELECT` a restricted column set
  (`physician_name, department, work_month, submitted_at`). No `anon` access;
  writes only via `service_role`.
- Migration: `automation/sql/p4p_submissions.sql`.

## `dept_heads`

**Purpose:** Maps each hospital department to its department head's email
address, so automation knows who to send the monthly score report to.

- **Columns:** `department` (PK), `head_email`, `updated_at`.
- Replaces a previous `DEPT_HEADS_JSON` GitHub secret (secrets are write-only;
  this table is viewable/editable via the Supabase Table Editor).
- Read by `getDeptHeads()` in `automation/supabase-client.js`; used by
  `score-tracker.mjs` / `resend-month.mjs`.
- **Access:** RLS enabled, no anon/authenticated policies — only
  `service_role` (the automation) can touch it.
- Migration: `automation/sql/dept_heads.sql`.

## `sender_physician_match`

**Purpose:** Links each *email sender address* (the "From" header of a
submission email) to the physician identity it was matched to.

- **Columns:** `sender_email` (PK), `sender_display_name`, `email_count`,
  `extracted_name`, `name_source`, `matched_physician`, `department`,
  `similarity`, `matched` (bool), `updated_at`.
- Replaces a previously-committed `sender-physician-match.csv`. Populated by
  the "Match Sender Emails" GitHub Action (batch, `saveSenderMatch`) and
  incrementally per live submission (`bumpSenderMatch`).
- Doubles as half of the **auth allow-list**: a `matched = true` row means
  that email belongs to a verified physician, allowed to request an OTP login
  on `/verify/` (see `is_sender_allowlisted()`).
- **Access:** RLS enabled, no anon/authenticated policies — reachable only via
  `service_role` or the `SECURITY DEFINER` allow-list functions.
- Migration: `automation/sql/sender_physician_match.sql`.

## `physician_directory`

**Purpose:** Admin-maintained allow-list of physicians permitted to log in,
independent of whether they've ever emailed a submission (covers new hires
with no submission history yet).

- **Columns:** `email` (PK), `full_name`, `department`, `active` (bool),
  `created_at`.
- Effective login allow-list is
  `physician_directory UNION sender_physician_match`. Toggling `active =
  false` revokes a directory-based entry without deleting it.
- Seeded once from `sender_physician_match` (matched senders only).
- **Access:** RLS, no anon/authenticated policies — reachable only via
  `SECURITY DEFINER` functions (`is_sender_allowlisted`,
  `is_current_user_allowlisted`) or `service_role`.
- Migration: `scripts/security-rls-auth.sql` (Block 0a).

## `access_requests`

**Purpose:** Audit log of login attempts from emails that are *not* on the
allow-list, so an admin can see who still needs to be added (visibility only,
not an approval gate).

- **Columns:** `email` (PK), `name` (self-reported), `requested_at`,
  `request_count`, `resolved` (bool), plus `approve_token` (added by
  `scripts/telegram-approve-buttons.sql`) for one-tap Telegram approve/reject.
- Written via the `log_access_request()` RPC, called from `/verify/` when a
  user's email fails the allow-list check.
- Optional triggers (`scripts/notify-access-request.sql`,
  `scripts/telegram-approve-buttons.sql`) fire a Telegram alert on INSERT with
  inline Approve/Reject buttons; approving inserts the physician into
  `physician_directory` via `approve_access_request()`.
- **Access:** RLS, no anon/authenticated SELECT — insert-only via the RPC.
- Migration: `scripts/security-rls-auth.sql` (Block 0a).

## `blocked_emails`

**Purpose:** Revocation/denylist that overrides both allow-list branches
(`physician_directory` and `sender_physician_match`) without deleting
underlying data.

- **Columns:** `email` (PK), `reason`, `blocked_at`.
- Checked first in `is_sender_allowlisted()` — if present, access is denied
  regardless of directory/match status. Used to revoke a departed physician's
  access while preserving their historical submission/match rows.
- **Access:** RLS, fully locked — admin edits only via Table Editor /
  `service_role`.
- Migration: `scripts/security-rls-auth.sql` (Block 0a).

## `line_user_bindings`

**Purpose:** Pure traceability — records which LINE account (from the LIFF
app) is behind a given verified email, for admin investigation. Explicitly
**not** an auth factor.

- **Columns:** `email` (PK), `line_user_id`, `line_display_name`, `bound_at`.
- Written via the `bind_line_user_id()` RPC right after a successful OTP
  verification; the function takes the email from the caller's own JWT, so a
  user can only ever bind their own account. First-verification-wins:
  `line_user_id`/`bound_at` never get overwritten after the initial bind
  (only display name refreshes).
- **Access:** RLS, no anon/authenticated SELECT — write only via the RPC
  (`authenticated` role); read only by `service_role` / dashboard.
- Migration: `scripts/bind-line-user.sql`.

## `email_sent_log`

**Purpose:** Dedup/audit log for the monthly score-report emailer — prevents
sending the same department the same month's report twice, and records when
each report actually went out.

- **Columns:** `table_name` (the `YYYY_MM` month key), `department`,
  `sent_at`, with a unique constraint on `(table_name, department)`.
- Checked by `score-tracker.mjs` before sending; a report is skipped if a row
  already exists for that department+month, and a row is upserted
  (`ignoreDuplicates: true`) after a successful send.
- **Access:** RLS enabled, `anon` revoked — only the automation's
  `service_role` key touches it (no client page reads it).
- Migration: `scripts/email-sent-log-setup.sql`.

---

## Architecture note

These tables split into two groups:

1. **Operational data** for the P4P workflow — `p4p_submissions`,
   `dept_heads`, `sender_physician_match`, `email_sent_log` — driven by the
   email-processing automation.
2. **Auth / allow-list plumbing** for the `/verify/` OTP login gate —
   `physician_directory`, `access_requests`, `blocked_emails`,
   `line_user_bindings`.

All of it is guarded by `SECURITY DEFINER` RPCs, so the underlying email/name
data is never exposed directly to `anon`/`authenticated` clients — only
yes/no or self-scoped results are.
