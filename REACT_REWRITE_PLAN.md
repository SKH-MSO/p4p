# React Rewrite Plan — P4P LIFF Front End

**Status:** proposal, not yet implemented
**Scope:** the four browser pages (`/verify/`, `/status/`, `/list/`, `/ranking/`), the shared
browser helpers in `assets/`, and the HTTP surface of `main.js` (gate, session, webhooks).
**Explicitly out of scope:** `automation/`, `process/`, `scripts/`, and every SQL migration.
No database schema changes. The LINE Flex-message builders move file but keep their logic
byte-for-byte.

---

## 0. Decisions taken

Three questions were open in the first draft. All three are now answered **yes**, and they
reshape the plan considerably:

| # | Decision | Consequence |
|---|---|---|
| 1 | **Next.js is the target**, not a later option | The Express server is replaced, not preserved. The gate becomes middleware. This is now the largest and riskiest part of the work, so it moves early rather than being avoided. |
| 2 | **Visual redesign is in scope** | No pixel-faithful CSS port. The four pages get one shared design system instead of four divergent stylesheets. Styling recommendation flips from CSS Modules to Tailwind (§4). |
| 3 | **`/verify/` can take a maintenance window** | A single clean cutover beats a hybrid Express/Next deployment. Combined with staging LIFF apps (§5), this removes most of the deployment risk. |

Decision 1 removes the main argument the first draft made for Vite, and decision 2 removes
the main argument it made for CSS Modules. Both recommendations are therefore reversed here
on purpose — the reasoning behind them was conditional, and the conditions changed.

One thing does **not** change: the gate rewrite stays its own phase, separate from the view
layer. It is the code with the incident history, and it should be reviewable on its own.

---

## 1. What exists today

| Area | Files | Size | Notes |
|---|---|---|---|
| Server / gate | `main.js` | 823 lines | Express on Vercel. Session cookie, token refresh, LINE-bind gate, page templating, LINE + Telegram webhooks. |
| Verify page | `verify/index.html` + `verify/app.js` | 313 + 552 | OTP login, access-request form, silent LINE-bind flow. |
| Status page | `status/index.html` + `status/app.js` | 385 + 344 | Per-month sent/pending roster, search, group-by-department. |
| List page | `list/index.html` + `list/app.js` | 337 + 318 | Month picker, sortable/paginated physician table. |
| Ranking page | `ranking/index.html` + `ranking/app.js` | 325 + 152 | 24 month tabs, on-time submission timeline. |
| Shared browser | `assets/shared.js`, `assets/auth-guard.js` | 75 + 51 | Constants, `escHtml`, the client half of the auth gate. |
| Shared server | `src/constants.cjs` | — | Month names + colors, duplicated from `assets/shared.js`. |

No build step, no front-end tests, ~1,300 lines of CSS with the same design tokens
copy-pasted into four files.

### The contract — behaviours that must survive the rewrite

These have incident history behind them (see the comment blocks in `main.js` and
`verify/app.js`, and the `2026-08` notes). They are requirements, not implementation detail:

1. **URL shapes.** `/status/`, `/list/`, `/ranking/` serve at the trailing-slash form, with a
   302 from the bare path that appends a **literal `#`** — this clears a stale fragment left
   by a *different* LIFF app. `/verify` and `/verify/` are both served directly with **no
   redirect between them**, because that redirect destroyed LIFF's `#access_token=…` login
   fragment and produced an infinite reload loop.
2. **Webhook and API paths.** `/line`, `/telegram/webhook`, `/auth/session`, `/line/bind`.
   These are registered with LINE and Telegram externally; keeping them identical means no
   re-registration at cutover, which is one less thing to get wrong during the window.
3. **LIFF app identity.** Each entry point is a separate LIFF app whose registered Endpoint
   URL must match the page it runs on: `2008561527-BXrxUUDb` and `2008561527-wyje9amz`
   (rich menu), `2008561527-a0xP1XmY` (month picker → `/status/`), `2008561527-AShTrJz0`
   (`/verify/`).
4. **Token never persists client-side.** LINE's in-app webview is unreliable at it. The
   server resolves the access token per request and hands it to the page.
5. **The bind flow's fail-open.** Three recorded failures then let the user through; a
   `mismatch` never counts toward that limit; a retry re-uses the same access token and never
   re-runs `verifyOtp` (OTP codes are single-use).
6. **The `p4p_bindloop` cookie backstop.** Pure server state, deliberately independent of
   Supabase, LINE, and client JS. Port it as-is.
7. **`LINE_BIND_ENFORCE` staged rollout semantics**, including the detect-only fail-open.
8. **No `unsafe-inline` on `script-src`.** See §6 — Next.js makes this harder, not easier.
9. **Thai copy.** Wording is reviewed and in production use. A redesign changes layout and
   visual language; it does not silently reword the UI.

---

## 2. Target architecture

**Next.js (App Router) + TypeScript, deployed on Vercel, replacing the Express server.**

```
app/
  layout.tsx
  verify/page.tsx           → /verify   (+ /verify/ via middleware rewrite)
  status/page.tsx           → /status/
  list/page.tsx             → /list/
  ranking/page.tsx          → /ranking/
  auth/session/route.ts     → POST /auth/session
  line/route.ts             → POST /line            (LINE bot webhook)
  line/bind/route.ts        → POST /line/bind
  telegram/webhook/route.ts → POST /telegram/webhook
middleware.ts               ← the gate + CSP nonce + URL canonicalisation
lib/
  gate/                     cookies, token refresh, gate RPC, bind-loop backstop
  line/                     LIFF helpers, Flex builders (moved from main.js verbatim)
  months.ts colors.ts departments.ts
components/                 the design system (§4)
```

### The gate becomes middleware

`servePage()` maps almost one-to-one onto a Next middleware. The order of operations is
identical, which is the point — this should read as a transcription, not a redesign:

| `main.js` today | Next equivalent |
|---|---|
| trailing-slash redirect with literal `#` | `NextResponse.redirect` in middleware, same literal `#` |
| `resolveAccessToken` (cached `at`, refresh near expiry, rotate cookie) | same logic in `lib/gate`, `fetch` instead of `axios` |
| `getLineBindGateStatus` RPC | same, `fetch` |
| `is_blocked` / `session_revoked` / `wantsBindRedirect` branches | same, unchanged |
| `p4p_bindloop` cookie backstop | same, `NextResponse.cookies` |
| `pageTemplates[name].replace(PAGE_TOKEN_PLACEHOLDER, at)` | **deleted** — middleware forwards the token as an `x-p4p-access-token` request header; the Server Component reads it via `headers()` and passes it to the client component as a prop |

Dropping the string-replace placeholder is the one genuine improvement the migration buys on
the server side: no `__P4P_ACCESS_TOKEN__` sentinel, no risk of an un-replaced placeholder
reaching the browser, and no `fs.readFileSync` of HTML at module load.

**Runtime note.** Middleware must resolve the token and call the gate RPC — both plain
`fetch`, both Edge-safe. The JWT payload read is `atob` + `JSON.parse`, also Edge-safe. The
service-role key stays out of middleware entirely; it is only needed in
`app/line/bind/route.ts` and `app/telegram/webhook/route.ts`, which run on the Node runtime.

### `/verify` and `/verify/` with no redirect

Next's `trailingSlash` config canonicalises with a 308 either way, which is exactly the
redirect that broke LIFF login. The fix is a middleware **rewrite** (internal, no navigation,
no `Location` header) so both paths render the same route. *This needs confirming on staging
before Phase 5 — it is the single most likely place for the old bug to reappear.*

### Webhook handlers

`line.middleware(config)` from `@line/bot-sdk` is Express-shaped and does not survive.
Replace it with the SDK's standalone `validateSignature(rawBody, channelSecret, signature)`
against the `x-line-signature` header, reading the raw body via `await req.text()` before
parsing. `export const runtime = "nodejs"` on that route.

The Telegram handler already does its own secret-header comparison and needs no signature
work — but keep the comment explaining why it responds only *after* all outbound calls
finish. That comment documents a real Vercel freeze-on-response bug and applies equally to
route handlers.

---

## 3. Dependencies

| Package | Why |
|---|---|
| `next`, `react`, `react-dom`, `typescript` | The rewrite. |
| `@supabase/supabase-js` | **npm, not the jsDelivr UMD bundle.** Removes a CDN origin and the SRI-pinning maintenance. |
| `@line/liff` | **npm, not `static.line-scdn.net`.** Removes the one CDN script that *cannot* be SRI-pinned, because LINE requires its unversioned auto-updating URL. Needs a compatibility check against the real LINE client in Phase 0 — if it diverges, keep the CDN tag and leave that origin in the CSP. |
| `@line/bot-sdk` | Kept, for `validateSignature` and `MessagingApiClient`. |
| `tailwindcss` | See §4. |
| `@radix-ui/react-{select,tabs,collapsible}` | Three genuinely fiddly widgets, correct keyboard/ARIA behaviour for free. Not a full component framework. |
| `@tanstack/react-query` | Ranking has 24 month tabs and refetches on every tab click today. |
| `vitest`, `@testing-library/react`, `jsdom` | Front-end tests, which currently do not exist. |
| `zod` | Validating the `sheetname` URL param and webhook payload shapes. |

`express` and `axios` are dropped.

---

## 4. Design system (redesign in scope)

Today the four pages look like three different products: `/status/` has a bare header,
`/list/` has a brand header with a live clock and a footer, `/ranking/` has a hero band with
scrolling tabs. Unifying them is most of the value of decision 2.

**Tailwind, not CSS Modules.** The first draft recommended CSS Modules specifically so a
pixel-faithful port would keep visual regressions attributable. With a redesign in scope
there is no port to be faithful to — every rule is being rewritten regardless — and
Tailwind's constraint-based scale is the better fit for building one consistent system
across four pages. `design.md`'s tokens become the Tailwind theme, so the palette,
type scale and radius have exactly one definition:

```
--color-primary: #A68966    --font-display: Manrope
--color-secondary: #4B3D33  --font-body: Work Sans / Noto Sans Thai Looped
--color-tertiary: #F5F5F0   --radius: 4px
--color-neutral: #FAF9F6
```

**Shared shell.** One `AppHeader` (brand, month context, live status dot), one page frame,
one `BackToTop`, one `StateBox` covering loading/empty/error, one skeleton treatment. These
exist four times today in four slightly different forms.

**Constraints the design must respect.** Mobile-only, portrait, inside LINE's webview.
Thai text sets taller than Latin, so line-height and touch targets need to be checked in
Thai, not in English lorem. Bundle size matters more than usual — the audience is on hospital
wifi and mobile data.

**What needs sign-off before Phase 2 starts.** The redesign direction itself. This plan
commits to *one coherent system built on the existing tokens*; it does not choose a new
visual language unilaterally. Suggested deliverable: a single annotated screen (the
`/status/` page, the densest one) reviewed before the other three are built.

**Deliberately not doing:** dark mode. `design.md` specifies a light-optimised system, and
LINE's webview does not reliably signal theme. Revisit separately if asked.

**Deduplication.** `COLOR_ARRAY` and the Thai month names currently exist in both
`src/constants.cjs` and `assets/shared.js`. They collapse into one TypeScript module imported
by both the pages and the Flex builders. `escHtml` disappears entirely — React escapes by
default, and every call site is a template-string `innerHTML` becoming JSX.

---

## 5. Staging LIFF apps — the thing that makes this safe

A Vercel preview deployment cannot be opened from LINE, because a LIFF app only runs at its
registered Endpoint URL. Without solving that, every change is verified for the first time in
production, in front of ~200 physicians.

**Register four staging LIFF apps** in the LINE Developers console pointing at a stable
Vercel preview alias (e.g. `p4p-next.vercel.app`), mirroring the four production ones. They
cost nothing, live alongside the existing apps, and mean every page is exercised in the real
LINE client — real webview, real ID tokens, real `openid` scope behaviour — before cutover.

This is a Phase 0 task and everything downstream depends on it.

**Webhooks stay pointed at production during staging.** Do not re-register the LINE bot or
Telegram webhook at the preview URL; that would double-handle live events. Exercise those two
route handlers with synthetic signed requests in tests instead. Because their paths are
unchanged, cutover needs no webhook re-registration at all.

---

## 6. CSP: Next.js makes this harder, and it needs handling deliberately

Today's `script-src 'self' https://cdn.jsdelivr.net https://static.line-scdn.net` has **no
`unsafe-inline`**, and the comment in `main.js` is explicit that all page JS was moved to
external files to earn that. Next.js emits inline bootstrap and RSC-payload scripts, so a
naive migration would force `'unsafe-inline'` back in and quietly undo it.

The supported fix is a **per-request nonce generated in middleware**: middleware sets both
the `Content-Security-Policy` and an `x-nonce` header, and Next applies that nonce to the
scripts it injects. Two documented consequences, both acceptable here:

- **It forces dynamic rendering.** Static optimisation and ISR are disabled. The gated pages
  already must be dynamic — they carry a per-request access token — so nothing is lost.
- **The middleware matcher should exclude static assets and prefetches**, or every image
  request pays for CSP processing.

End state, once both CDN script origins are gone (§3):

```
script-src 'self' 'nonce-<per-request>'
```

Strictly better than today. But it is a Phase 1 requirement, not a cleanup task — shipping
without it is a security regression against the current app.

Sources: [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy) ·
[nonce setup walkthrough](https://centralcsp.com/articles/how-to-setup-nonce-with-nextjs)

---

## 7. Phasing

**Phase 0 — foundations.** Next scaffold, TypeScript, Tailwind theme from `design.md`, shared
`lib/` ported with unit tests, Vitest in CI alongside the existing `automation-tests.yml`,
`@line/liff` npm compatibility check, **four staging LIFF apps + stable preview alias**.
*Exit: a placeholder page opens inside LINE from a staging LIFF app.*

**Phase 1 — gate and API surface.** Middleware (canonicalisation, session, gate RPC,
bind-loop backstop, CSP nonce) and the four route handlers. Logic transcribed from `main.js`
with comments carried across; no behaviour changes, no view work. *Exit: unit tests cover
every gate branch, and the nonce CSP is verified in a browser with no `unsafe-inline`.*

**Phase 2 — design system + `/status/`.** The densest page, built first so the system is
exercised properly rather than designed against the easiest case. Includes the redesign
sign-off gate from §4. *Exit: reviewed on a real device in LINE via staging LIFF.*

**Phase 3 — `/list/`.** Pagination, sorting, search. Removes the largest concentration of
`innerHTML` in the codebase.

**Phase 4 — `/ranking/`.** 24 month tabs, on-time timeline. React Query earns its place here.
Fix the timezone bug (§8).

**Phase 5 — `/verify/`.** Last, still. OTP, access requests, and the LIFF bind flow with its
retry/fail-open/mismatch branches, ported as an explicit `email → code → request → bind`
state machine. This is also where the `/verify` vs `/verify/` rewrite gets confirmed.
*Exit: a real end-to-end bind on a device via staging LIFF, confirmed by a row in
`line_verified_sessions`.*

**Phase 6 — cutover.** See §9.

**Phase 7 — decommission.** Delete `main.js`, `verify/`, `status/`, `list/`, `ranking/`,
`assets/`, `src/constants.cjs`. Rewrite `eslint.config.mjs` (its browser-globals block and
`supabase`/`liff`/`P4P` globals become meaningless). Retire the staging LIFF apps.

---

## 8. Bugs to fix during the rewrite

Found while reading the current code. Each should land as its own commit inside the relevant
phase, so it is visible in review rather than buried in a rewrite diff:

- **`status/app.js:23`** — `par_sheetname` goes straight from the URL into `db.from()` with no
  validation. Validate against `/^\d{4}_\d{2}$/` (this is the `zod` line item in §3).
- **`ranking/app.js:34`** — `formatTime` renders `submitted_at` in the *device's* timezone.
  Every user is in Thailand, but a device set to another zone silently shows wrong times on a
  page whose entire purpose is ordering by time. Format in `Asia/Bangkok` explicitly.
- **`list/app.js:37`** — `toBE(year, month)` is called with two arguments; `toBE` takes one.
  Harmless today, but the month-window code reads as if it does something it doesn't.
- **`status/app.js:54`** — `arr` and `count_true` are module-level mutable state, never reset.
  Single-load pages today; a bug the moment components mount and unmount.
- **`list/app.js:69`** — the clock `setInterval` is never cleared.

---

## 9. Cutover runbook

Uses the maintenance window from decision 3. Target a date outside the 1st–15th submission
window, when `/verify/` traffic is lowest.

**Before:** all five phases merged and verified on staging; a rich-menu message announcing the
window; `LINE_BIND_ENFORCE` left at its current value (do not combine a rollout switch with a
cutover).

1. Point the production Vercel project at the Next build; deploy without promoting.
2. Verify on the preview alias one last time — all four pages, in LINE.
3. Promote to production.
4. Update the four **production** LIFF Endpoint URLs only if any path changed. It should not
   have; if step 4 is a no-op, the migration is correct.
5. Smoke test in this order: `/verify/` OTP → bind → redirect to `/status/`; then `/list/`,
   `/ranking/`; then a real LINE bot `status` message; then a Telegram approve button.
6. Watch Vercel logs for `[gate]`, `[line-bind]`, `[bind-loop]` and `[tg-webhook]` lines for
   the first hour — the existing log prefixes are preserved specifically so this step works.
7. Confirm fresh rows in `line_verified_sessions`.

**Rollback:** promote the previous Vercel deployment. Because the paths and webhook
registrations are unchanged, rollback is one click and needs no LINE-console edits. That
property is worth protecting — it is the main reason §2 insists the paths stay identical.

---

## 10. Testing

| Layer | Tool | What |
|---|---|---|
| Gate | Vitest | Every branch of the middleware: no cookie, expired refresh, blocked, revoked, bind-required under/over the limit, loop-backstop tripped, gate RPC unreachable in both `LINE_BIND_ENFORCE` modes. Zero coverage today; the branches that lock people out. |
| Webhooks | Vitest | LINE signature valid/invalid/missing; Telegram secret mismatch; `callback_query` parsing. |
| Pure logic | Vitest | `months.ts` (BE conversion, 6- and 24-month windows, the `2569_04` floor, deadlines), department sort order, filter/sort/pagination. |
| Components | Vitest + RTL | `OtpInput` (type, paste, backspace, arrows, bulk autofill), status view-mode transitions, list pagination edges. |
| Bind flow | Vitest + RTL | Mocked `/line/bind`: success, `403 mismatch`, failure under the limit, failure at the limit. |
| End to end | Playwright | Non-LIFF paths: desktop block, missing-token redirect to `/verify/`, CSP header shape. Chromium is already available in CI. |
| Real device | Manual | Every phase, in LINE, via staging LIFF. Not optional — the webview is where this app's bugs live. |

The existing `automation/test/*` suite (`node:test`) is untouched and keeps running.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| The `/verify` vs `/verify/` redirect bug returns via Next's routing. | Middleware rewrite, not `trailingSlash`. Explicitly re-tested in Phase 5 on a real device. |
| Next's inline scripts force `unsafe-inline` back into the CSP. | §6. Treated as a Phase 1 requirement, not cleanup. |
| Middleware Edge runtime can't do something the gate needs. | Everything it needs is `fetch` + `atob`. If that proves wrong, the middleware can be pinned to the Node runtime. |
| `@line/liff` npm diverges from the CDN "edge" SDK. | Checked in Phase 0. Fallback is the existing CDN tag, at the cost of one CSP origin. |
| Redesign scope creeps and delays the migration. | One sign-off gate on one screen (§4), before three of the four pages are built. |
| Cutover lands mid-submission-window. | Scheduled outside the 1st–15th; rollback is a single Vercel promotion (§9). |
| Rewriting the gate reintroduces a lockout. | It is transcribed, not redesigned; comments carried across; every branch unit-tested; `LINE_BIND_ENFORCE` untouched during the cutover. |

---

## 12. Effort

| Phase | Estimate |
|---|---|
| 0 — scaffold, Tailwind theme, lib, staging LIFF, CI | 2 days |
| 1 — gate, middleware, CSP nonce, webhooks | 2–3 days |
| 2 — design system + `/status/` (incl. sign-off) | 3 days |
| 3 — `/list/` | 1.5 days |
| 4 — `/ranking/` | 1 day |
| 5 — `/verify/` | 2 days |
| 6 — cutover + monitoring | 0.5 day |
| 7 — decommission, lint config | 0.5 day |
| **Total** | **~12–13 days** |

Roughly double the Vite-only estimate in the first draft. The increase is the gate rewrite
(~3 days) and the redesign (~3 days) — both deliberate, both consequences of decisions 1
and 2 rather than scope creep.
