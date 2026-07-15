# Operations & Supabase configuration

Settings the P4P web tier **depends on** but that live in the Supabase dashboard
(or as environment variables), not in this repo. The code is correct only when
these are configured. Grouped by the risk they address.

## 1. Auth abuse — OTP spam / `auth.users` pollution  (P0-3)

The `/verify/` allow-list is checked in **client JS**, so anyone with the public
anon key can call `signInWithOtp({ email, shouldCreateUser: true })` for *any*
address directly. This never leaks data (RLS protects that — see
`scripts/security-rls-auth.sql`), but it lets an attacker send OTP emails to
arbitrary victims and create junk `auth.users` rows.

Mitigations (do all that apply):

- [ ] **Auth rate limits** — Dashboard → Authentication → Rate Limits. Keep the
      built-in limits enabled and tighten "Sign up / sign in" and "Token
      refresh" to the lowest values that still work for the physician roster
      size. This is the primary, lowest-effort defense.
- [ ] **CAPTCHA** — Dashboard → Authentication → Bot & Abuse Protection → enable
      hCaptcha/Turnstile. Requires a matching CAPTCHA token on the client
      `signInWithOtp` call (a `verify/` change), so schedule the two together.
- [ ] **Custom SMTP** — Dashboard → Authentication → SMTP. The default Supabase
      mailer is rate-limited to a few/hour and is not for production.
- [ ] **(Optional, stronger) Before-User-Created hook** — server-side allow-list
      enforcement at signup. Template in `scripts/auth-hook-restrict-signups.sql`
      — **untested, verify against current Supabase docs before enabling.**

## 2. Refresh-token rotation race  (P0-2)

`resolveAccessToken()` in `main.js` refreshes the access token near expiry and
Supabase **rotates the refresh token** on each refresh. Two near-simultaneous
requests (a page load plus an `/auth/token` call, or rapid navigation) can both
present the same refresh token. Supabase would normally flag the second use as
token reuse and **revoke the entire session** — except for the reuse grace
window below, which returns the same rotated token to both callers.

- [ ] **Refresh Token Reuse Interval** — Dashboard → Authentication → Sessions →
      keep this **enabled** and at a sane value (default **10s**; do not set 0).
      This is what makes concurrent refreshes safe. On Vercel's serverless
      runtime, instances don't share memory, so an in-process lock cannot close
      this race — the reuse interval is the real safeguard.

## 3. OTP brute-force / hygiene  (hardening)

- [ ] **Email OTP expiry** — Dashboard → Authentication → shorten (e.g. 300s). A
      6-digit code is only ~1e6 combinations; a long window widens brute force.
- [ ] **Magic Link template** must include the numeric token (`{{ .Token }}`) so
      the 6-digit box on `/verify/` works — see `scripts/security-rls-auth.sql`.
- [ ] **Anonymous sign-ins OFF** — an anonymous JWT has no email and is denied by
      `is_current_user_allowlisted()`, but there's no reason to mint such tokens.
- [ ] Keep **"Allow new users to sign up" ON** — `verify/` uses
      `shouldCreateUser: true` so a newly added physician can log in on first
      try; RLS (not this toggle) is what restricts data.

## 4. Server environment variables

Set in Vercel (see `.env.example` for the full list). The server-only secrets
must never reach the browser:

- `LINE_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS; used only by the Telegram
  approve/reject webhook in `main.js`.
