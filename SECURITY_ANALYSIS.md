# P4P — App Data Security Analysis

**Scope:** MFA · rate limiting · anomaly detection
**Reviewed:** `main.js`, `verify/`, `assets/`, `status|list|ranking/`, `scripts/*.sql`, `automation/`
**Date:** 2026-08

> **Verification caveat.** This is a static review of the code and migration
> scripts in this repo. The live Supabase project for P4P
> (`zjeizbrzcltkgtlmkbji`) was **not** reachable from this session — the
> connected Supabase account only exposes an unrelated project — so every
> statement about *dashboard-side* configuration (OTP expiry, built-in auth
> rate limits, CAPTCHA, MFA providers, whether the signup hook is actually
> enabled) is an **assumption to confirm**, not a verified fact. Items that
> depend on this are marked ⚠️ **unverified**.

---

## 0. What is being protected

| Asset | Where | Sensitivity |
|---|---|---|
| Physician rosters `YYYY_MM` (name, department, submission time) | Supabase, RLS-gated | Personal data, internal |
| `p4p_submissions` (who submitted what, when) | Supabase, RLS-gated | Personal data, internal |
| Email allow-list (`physician_directory`, `sender_physician_match`, `dept_heads`) | Supabase, no client access | **PII — email + name of every physician** |
| `line_user_bindings` (email ↔ LINE userId) | Supabase, no client access | **Cross-identity linkage** |
| `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, LINE tokens | Vercel env | **Full DB bypass / bot takeover** |

The data itself is well protected at rest: RLS is default-deny, roster reads are
column-restricted (`main.js`/`security-rls-auth.sql`), and every table holding
email addresses is reachable only through `SECURITY DEFINER` RPCs that return
booleans or self-scoped writes. **The weak surface is the login path and the
absence of any observability on it**, which is exactly what the three review
areas cover.

---

## 1. MFA — Multi-Factor Authentication

### Current state: single factor

The entire authentication story is **one factor — possession of an email inbox**:

1. `verify/app.js:394` — anon RPC `is_sender_allowlisted(email)` (client-side check).
2. `verify/app.js:409` — `signInWithOtp({ email, shouldCreateUser: true })`.
3. `verify/app.js:437` — `verifyOtp()` → session.
4. `main.js:245` — tokens posted to `/auth/session`, refresh token stored in an
   HttpOnly cookie.

There is **no second factor**. Supabase's own MFA (TOTP / phone) is not enrolled
or enforced anywhere in the codebase, and no `aal2` / assurance-level check
exists in any RLS policy — `is_current_user_allowlisted()`
(`scripts/security-rls-auth.sql`) tests only `auth.jwt() ->> 'email'`.

### The second factor already exists but is deliberately not used

`line_user_bindings` records the LINE `userId` behind each verified email, and
`scripts/bind-line-user.sql` states the intent explicitly:

> "Purpose: pure traceability, **NOT an auth factor**."
> "If the same email later verifies from a different LINE account, this table
> will still show the original userId — that mismatch is exactly the kind of
> thing worth noticing manually; **no automatic alerting is added here**."

The gate in `main.js:198-207` checks only three things: *blocked?*, *bound at
all?*, *attempt count*. It never asks **"is the LINE account in front of me the
same one bound to this email?"**

**Consequence:** an attacker who reads a physician's email (shared inbox,
forwarded mail, compromised Gmail, an OTP shoulder-surf) can complete the whole
flow from **their own LINE account** and read every physician's roster data.
The bind step will happily overwrite nothing and let them in — `ON CONFLICT
(email) DO UPDATE` only refreshes the display name, so the *original* userId
stays in the table and **the login still succeeds**.

### Fail-open paths that weaken the gate further

| Path | Code | Behaviour |
|---|---|---|
| Gate RPC errors | `main.js:154-157` | returns `null` → gate skipped entirely |
| ≥3 failed binds | `main.js:204`, `verify/app.js:212` | user let through **unbound**, one Telegram alert, never repeated |
| `record_bind_failure` itself fails | `verify/app.js:180-183` | returns `BIND_ATTEMPT_LIMIT` → treated as "at the limit" → let through |
| Bind succeeds for *any* LINE account | `bind_line_user_id()` | no comparison against existing row |

Each of these is individually defensible (a monthly-use tool must not lock a
physician out over a webview quirk), but stacked together the binding provides
**no security value at all** — only after-the-fact forensics, and only if
someone reads the table.

### Session longevity

`main.js:79` — `Max-Age=34560000` (**400 days**). Combined with rolling refresh,
a single successful OTP grants effectively permanent access. There is no
re-authentication interval, no absolute session lifetime, and no device/session
list an admin can revoke. Revocation works (`blocked_emails` is re-checked on
every gated page load — `main.js:200`), but it is all-or-nothing and manual.

### Recommendations (MFA)

**P1 — Make the LINE binding a real second factor.** The plumbing is 90% built.
Change the gate from *"is bound"* to *"is bound **and matches**"*:

- Add an RPC `verify_line_binding(p_line_user_id)` that compares the caller's
  live `liff.getProfile().userId` against `line_user_bindings.line_user_id` for
  the JWT's email.
- On mismatch: **deny**, log it, fire a Telegram alert. This is the single
  highest-value change in this document — it converts "something you have
  (email)" into "email **+** a specific LINE account", and LINE accounts are
  device-bound, which is a genuinely strong second factor for this user base.
- Keep a break-glass path: an admin-clearable `line_bind_reset` flag so a
  physician who legitimately changes phone/LINE account can re-bind after
  manual approval, rather than being locked out.

**P2 — Bound the fail-open.** Today "3 failures → in anyway, forever". Change to
"3 failures → in for this session only, flagged, and the alert repeats on each
new session" so a persistent bypass is not silent after the first alert.

**P3 — Shorten the session.** 400 days is far beyond what a monthly-use tool
needs. 30 days rolling (or 90 max) would cut the value of a stolen cookie by an
order of magnitude at essentially zero UX cost.

**P4 — Consider Supabase MFA (TOTP) for admins only.** Full TOTP for ~hundreds
of physicians in a LINE webview is likely a UX non-starter; but any human with
`service_role` / dashboard access should have it, and that is a dashboard
setting, not code. ⚠️ **unverified** whether dashboard 2FA is on today.

---

## 2. Rate limiting

### Current state: none in application code

`main.js` mounts four routes and **not one has a rate limit, quota, or
backpressure**. `package.json` has no rate-limit dependency, and `vercel.json`
configures no WAF/limits.

| Endpoint | Auth required | Cost of one request | Abuse |
|---|---|---|---|
| `POST /auth/session` (`main.js:245`) | none | outbound call to Supabase `/auth/v1/user` | Unauthenticated attacker can force **unbounded** Supabase auth traffic; also a **token-validity oracle** (401 vs 200) |
| `GET /status\|/list\|/ranking` (`main.js:360`) | cookie | 1–2 Supabase calls (refresh + gate RPC) | Cookie-less requests still hit `resolveAccessToken` → cheap, but the gate RPC path is anon-callable |
| `POST /telegram/webhook` (`main.js:264`) | shared secret | rejected pre-work at `main.js:276` | Low — but see timing note below |
| `POST /line` (`main.js:391`) | HMAC signature | rejected by `line.middleware` | Low |

### Anon-callable Supabase RPCs — the real exposure

Three functions are granted to `anon` and reachable by **anyone** with the
publishable key (which is, correctly, in page source at `assets/shared.js:15`):

```
is_sender_allowlisted(p_email)        -- "is this address a physician?"  yes/no
get_line_bind_gate_status(p_email)    -- blocked? bound? attempt count
log_access_request(p_email, p_name)   -- unauthenticated INSERT + Telegram alert
```

1. **Email enumeration, unlimited.** The first two are oracles over the physician
   roster. Given a hospital's predictable address format, an attacker can
   enumerate the full physician email list at whatever rate PostgREST accepts —
   there is no per-IP limit on a Supabase RPC. `security-rls-auth.sql` itself
   flags this ("consider Supabase Auth rate limits / CAPTCHA if abuse is seen")
   but nothing was ever added.

2. **OTP email spam.** `signInWithOtp` is callable directly against Supabase for
   **any** address — the allow-list check at `verify/app.js:394` is client-side
   only. `scripts/auth-hook-restrict-signups.sql` would fix this server-side,
   but the file is explicitly a **⚠️ template, "DO NOT paste into production
   blind"** — ⚠️ **unverified** whether it is enabled. If it is not, the app can
   be used to mail OTPs to arbitrary victims from the hospital's domain, and to
   pollute `auth.users`.

3. **Telegram flood + social-engineered allow-list insertion.**
   `log_access_request` is anon-executable with **attacker-controlled email and
   name**, and `notify_access_request()` fires a Telegram message *with inline
   Approve/Reject buttons* on every INSERT. An attacker can:
   - flood the admin chat (one message per distinct email — thousands, trivially), and
   - craft a request that looks like a real physician (`p_name` is free text
     chosen by the attacker) hoping the admin taps ✅.
   One tap runs `approve_access_request()`, which **inserts the attacker's email
   into `physician_directory`** — i.e. a full allow-list bypass reachable
   without any authentication. Alert fatigue from the flood makes the mis-tap
   *more* likely, not less.

4. **OTP brute force.** A 6-digit code is 10⁶ combinations. Defence rests
   entirely on Supabase's built-in verification-attempt limit and the OTP expiry
   window. `security-rls-auth.sql` recommends shortening expiry to 300s; the
   Supabase default is far longer. ⚠️ **unverified** in the live project.

### Minor

- `main.js:276` compares the Telegram secret with `!==` — not constant-time.
  Remote timing attacks over HTTP are impractical here, but
  `crypto.timingSafeEqual` on equal-length buffers costs nothing.
- `main.js:267,278,286,294` log on every webhook hit. Verbose logging on an
  unauthenticated-reachable endpoint is itself a (cheap) amplification target.

### Recommendations (rate limiting)

**P1 — Enable Supabase Auth rate limits + CAPTCHA.** Dashboard-side, no code:
Auth → Rate Limits (OTP sends per hour per IP/email) and Auth → CAPTCHA
(hCaptcha/Turnstile) on the OTP endpoint. This is the fastest, highest-coverage
mitigation for items 1, 2 and 4 above. Note the CSP at `main.js:226-235` would
need the CAPTCHA host added to `script-src`/`connect-src`/`frame-src`.

**P2 — Enable the signup hook.** Validate `scripts/auth-hook-restrict-signups.sql`
against current Supabase docs on a staging project, then turn it on. It converts
the allow-list from a client-side courtesy into a server-side rule and kills the
OTP-spam vector at the source.

**P3 — Rate-limit `log_access_request` in SQL.** Cheapest fix for the Telegram
flood: inside the function, reject (silently return) if more than N inserts have
occurred in the last hour globally, or if the same IP/email has already
requested recently. Add a hard cap on `p_name` length and strip control
characters — it is rendered straight into a Telegram message today.

**P4 — Add per-IP limits on the Express routes.** On Vercel, prefer the platform
WAF / firewall rules for `/auth/session` (e.g. 10/min/IP). If staying in code, a
small fixed-window counter keyed on `x-forwarded-for` is enough — but note
serverless instances do not share memory, so an in-process limiter is only
partially effective; a Supabase-backed counter or the platform WAF is the
correct layer.

**P5 — Rate-limit the two enumeration oracles.** Same treatment as P3, or move
`get_line_bind_gate_status` to `authenticated`-only — `main.js:198` calls it
*after* a valid session already exists, so the `anon` grant appears unnecessary.
That is a one-line grant change with no functional impact.

---

## 3. Anomaly detection

### Current state: two narrow alerts, no logging, no baseline

Everything that exists:

| Signal | Trigger | Limitation |
|---|---|---|
| New access request | `notify_access_request()` — Telegram on **INSERT** | Repeat attempts are `ON CONFLICT DO UPDATE`, so a **persistent attacker on one address is completely silent** after the first message |
| ≥3 failed LINE binds | `record_bind_failure()` — Telegram | **Fires exactly once, ever** (`admin_notified` latch). Post-alert the email is permanently allowed through unbound with no further signal |
| Vercel `console.log` | `/telegram/webhook` only | Ephemeral platform logs, no retention policy, no alerting, nobody reads them |

### What is not detected at all

- **No authentication audit trail.** There is no record of successful logins,
  failed OTP attempts, session refreshes, or which email read which month's
  data. Supabase Auth keeps its own logs, but nothing in this project surfaces,
  retains, or alerts on them. After an incident there would be **no way to
  answer "who accessed what, when"** beyond `line_user_bindings.bound_at`.
- **LINE userId mismatch** — the single strongest available compromise
  indicator, explicitly left unalerted by design (`bind-line-user.sql`).
- **Impossible-travel / new-device / velocity signals** — no IP, user-agent, or
  geo is captured anywhere.
- **Bulk read detection.** An allow-listed session can page through every roster
  table. `ranking/app.js:114` self-limits to 500 rows, but that is a client
  courtesy — the RLS policy imposes **no row cap**. A single compromised
  physician account can extract the entire dataset with no signal raised.
- **Enumeration bursts** against the anon RPCs (§2) — invisible.
- **Service-role key misuse.** The key that bypasses all RLS is used by
  `/telegram/webhook` and by every GitHub Action in `.github/workflows/`. There
  is no alert if it is used from an unexpected source, and no key rotation
  schedule in the repo.
- **Off-hours / out-of-season access.** This is a *monthly* tool with an
  extremely predictable usage shape — which makes baseline-deviation detection
  unusually easy here, and its absence unusually costly.
- **Alert delivery is single-channel and unmonitored.** Every alert goes to one
  Telegram chat. If the bot token is revoked or the chat is muted, all detection
  silently stops. There is no heartbeat proving the alert path still works.

### Recommendations (anomaly detection)

**P1 — Add an `auth_events` audit table.** One table, written by the server on
every session-affecting action (`/auth/session` success/failure, gate denial,
bind success/mismatch/failure, page access), capturing `email`, `event`,
`ip` (`x-forwarded-for`), `user_agent`, `line_user_id`, `at`. Service-role
write, no client read. Nothing else in this list is possible without it — and
it is a few hours of work.

**P2 — Alert on LINE userId mismatch.** The highest-signal, lowest-noise
detection available in this system: a bound email verifying from a *different*
LINE userId is either a phone change or a compromise, and both warrant a human
look. Pairs directly with MFA-P1.

**P3 — Make the existing alerts non-latching.** Re-alert on repeat access
requests (e.g. every 5th attempt, or when `request_count` crosses thresholds)
and on continued bind failures after the first alert. A one-shot alert is a
detection gap dressed as noise control.

**P4 — Daily digest + heartbeat.** A scheduled job (the repo already runs
`.github/workflows/*` on cron) summarising: logins, new emails seen, failed
OTPs, access requests, bind anomalies, row-read volume per user. Send it even
when the numbers are zero — that is the heartbeat proving the alert channel is
alive, and a zero-day-in-a-quiet-month digest costs nothing to read.

**P5 — Threshold rules on top of `auth_events`.** Once the table exists these
are single queries: >N distinct emails attempting OTP from one IP in an hour;
>N failed OTPs for one email; any access outside the normal submission window;
any single session reading >N rows. Route to the same Telegram chat, but
consider a second channel (email to the admin) so detection does not depend on
one bot token.

**P6 — Retention + rotation.** Decide how long `auth_events` and Vercel logs are
kept (the data is health-staff PII — keep it short and deliberate, e.g. 90
days), and set a rotation reminder for `SUPABASE_SERVICE_ROLE_KEY`,
`TELEGRAM_BOT_TOKEN`, and the LINE channel tokens.

---

## 4. Priority summary

| # | Action | Area | Effort | Impact |
|---|---|---|---|---|
| 1 | Enforce LINE userId **match** as a second factor (not just "bound") | MFA | M | **High** |
| 2 | Enable Supabase Auth rate limits + CAPTCHA on OTP | Rate limit | S (dashboard) | **High** |
| 3 | Add `auth_events` audit table | Anomaly | M | **High** |
| 4 | Enable/validate the signup allow-list hook | Rate limit | S | High |
| 5 | Rate-limit + sanitise `log_access_request` (Telegram flood → mis-approval) | Rate limit | S | High |
| 6 | Alert on LINE userId mismatch | Anomaly | S | High |
| 7 | Shorten session from 400 days | MFA | S | Medium |
| 8 | Make existing alerts non-latching; add daily digest/heartbeat | Anomaly | M | Medium |
| 9 | Bound the bind fail-open to one session | MFA | S | Medium |
| 10 | Move `get_line_bind_gate_status` off the `anon` grant | Rate limit | XS | Medium |
| 11 | Per-IP limit on `/auth/session` (platform WAF) | Rate limit | S | Medium |
| 12 | `timingSafeEqual` for the Telegram webhook secret | Rate limit | XS | Low |

### What is already good

Worth stating plainly, because the baseline is better than most projects this
size: RLS is default-deny with column-level grants; every PII table is
unreachable except through `SECURITY DEFINER` RPCs returning booleans;
`bind_line_user_id()` takes the email from the JWT rather than the client;
the refresh token is HttpOnly/Secure/SameSite with the access token held only in
memory; there is a real CSP with no `unsafe-inline` in `script-src` and SRI on
the CDN bundles; the open-redirect check at `verify/app.js:50` is correct; the
LINE webhook is signature-verified and the Telegram webhook is secret-verified;
and revocation via `blocked_emails` is re-checked on **every** gated page load,
not just at login. The gaps above are about the **login path and
observability**, not about data exposure at rest.
