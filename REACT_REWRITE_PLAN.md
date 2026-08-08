# React Rewrite Plan — P4P LIFF Front End

**Status:** proposal, not yet implemented
**Scope:** the four browser pages (`/verify/`, `/status/`, `/list/`, `/ranking/`) and the
shared browser helpers in `assets/`.
**Explicitly out of scope:** `automation/`, `process/`, `scripts/`, the LINE bot handlers
and Flex-message builders in `main.js`, and every SQL migration. None of those are
front-end code and none of them change here.

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

Every page is hand-written DOM manipulation with a large inline `<style>` block. There is
no build step, no test coverage on the front end, and roughly 1,300 lines of CSS with the
same design tokens copy-pasted into four files.

### The parts that are load-bearing

These behaviours have incident history behind them (see the comment blocks in `main.js`
and `verify/app.js`, and the `2026-08` notes). The rewrite must preserve them exactly —
they are a **contract**, not implementation detail:

1. **URL shapes.** `/status/`, `/list/`, `/ranking/` are served at the trailing-slash form
   with a 302 from the bare path that appends a literal `#`. `/verify` and `/verify/` are
   both served directly with **no** redirect between them, because that redirect destroyed
   LIFF's `#access_token=…` login fragment and produced an infinite reload loop.
2. **Token injection.** Every page ships `<meta name="p4p-session" content="__P4P_ACCESS_TOKEN__">`.
   The server string-replaces the placeholder per request. The browser never persists a
   Supabase session — LINE's in-app webview is unreliable at it.
3. **LIFF app identity.** Each entry point is a separate LIFF app whose registered Endpoint
   URL must match the page it runs on: `2008561527-BXrxUUDb` and `2008561527-wyje9amz`
   (rich menu), `2008561527-a0xP1XmY` (month picker → `/status/`), `2008561527-AShTrJz0`
   (`/verify/`). Changing a path means editing the LINE Developers console, the rich menu,
   and the Flex month picker in lockstep.
4. **The bind flow's fail-open.** Three recorded failures then let the user through;
   a `mismatch` never counts toward that limit; a retry re-uses the same access token and
   never re-runs `verifyOtp` (OTP codes are single-use).
5. **CSP with no `unsafe-inline` on scripts.** All page JS is external for exactly this reason.
6. **Thai copy, verbatim.** Including the desktop/non-LINE block, which swaps its wording
   when the UA is mobile-but-not-LINE.
7. Smaller ones: the 5 s loading-dot delay on the email input, the six-box OTP
   paste/backspace/arrow behaviour, `p4p_verify_pending` in `localStorage` with a 15-minute
   TTL, the `p4p_bindloop` cookie backstop.

---

## 2. Framework choice

### Recommendation: Vite + React + TypeScript, four HTML entry points, Express untouched

Build the front end with Vite in multi-page mode, emitting `dist/verify/index.html`,
`dist/status/index.html`, `dist/list/index.html`, `dist/ranking/index.html`. Keep `main.js`
as the server; the only change it needs is reading its page templates and static assets
from `dist/` instead of the four source directories.

**Why this over Next.js.** Next.js is the more idiomatic answer on Vercel and would let the
gate live in server components. But the gate is the single most fragile part of this
codebase — cookie rotation, refresh-token reuse detection, the LIFF fragment, the
redirect-loop backstop, the staged `LINE_BIND_ENFORCE` rollout — and it has already caused
two production lockouts. A ground-up React rewrite that *also* reimplements that logic
against a different request/response model doubles the risk of the riskiest area for no
user-visible gain. Vite keeps the blast radius inside the view layer, where the rewrite
actually pays off.

Multi-page (not SPA routing) is deliberate: the four URLs are registered externally in the
LINE console, and a client-side router would change how the LIFF login fragment is handled
on first load. Four independent entry points reproduce today's navigation model exactly.

**If Next.js is wanted anyway,** it is a viable Phase 6 after the view layer lands: the
pages would already be React by then, so it becomes a routing/hosting migration rather than
a rewrite, and can be judged on its own. It is not a prerequisite for anything below.

### Dependencies to add

| Package | Why |
|---|---|
| `vite`, `@vitejs/plugin-react` | Build + dev server. |
| `react`, `react-dom`, `typescript` | The rewrite. |
| `@supabase/supabase-js` | **npm, not the jsDelivr UMD bundle.** Removes `cdn.jsdelivr.net` from `script-src` and the SRI-pinning maintenance. |
| `@line/liff` | **npm, not `static.line-scdn.net`.** Removes the one CDN script we cannot SRI-pin, because LINE requires the unversioned auto-updating URL. Needs a compatibility check against the LINE client before `/verify/` ships. |
| `@tanstack/react-query` | Ranking has 24 month tabs and refetches on every tab click today. Query caching is the one place a data library earns its weight. |
| `vitest`, `@testing-library/react`, `jsdom` | Front-end tests, which currently do not exist. |

Net CSP after the rewrite: `script-src 'self'` only. That is a real security improvement
and it falls out of the build step rather than being extra work.

### Styling

CSS Modules over a utility framework. The existing CSS is already written, already matches
`design.md`, and porting it faithfully is the goal of Phase 1–4; a Tailwind conversion would
mean rewriting 1,300 lines of visual code at the same time as the logic, which makes any
visual regression impossible to attribute. Structure:

```
src/styles/tokens.css      # the :root block, defined once instead of four times
src/styles/base.css        # reset, body, fonts, .skeleton, spinner keyframes
src/components/**/*.module.css
```

Fonts stay on Google Fonts initially. Self-hosting the Sarabun/Noto woff2 already in
`src/fonts/` would drop two more origins from the CSP — worth doing, but as its own change.

---

## 3. Target structure

```
src/
  entries/
    verify/main.tsx        index.html lives at src/entries/verify/index.html
    status/main.tsx
    list/main.tsx
    ranking/main.tsx
  app/
    VerifyPage.tsx
    StatusPage.tsx
    ListPage.tsx
    RankingPage.tsx
  components/
    DesktopBlock.tsx       the "open in LINE" full-screen block, all four pages
    BackToTop.tsx
    Spinner.tsx
    StateBox.tsx           loading / empty / error, shared by list + ranking
    OtpInput.tsx           the six-box control, with its paste/backspace behaviour
  hooks/
    useInjectedToken.ts    reads <meta name="p4p-session">, redirects if absent
    useSupabase.ts         builds the client from the injected token
    useLineOnly.ts         the UA guard
    useMonthTable.ts       react-query wrapper over db.from(<YYYY_MM>)
  lib/
    months.ts              BE conversion, month keys, Thai labels, 6/24-month windows, deadlines
    colors.ts              COLOR_ARRAY
    departments.ts         the Thai department order used for sorting
    liff.ts                init + getIDToken, with the error-description helper
    errors.ts              describeError()
  styles/
```

**Deduplication.** `COLOR_ARRAY` and the Thai month names currently exist in both
`src/constants.cjs` (server) and `assets/shared.js` (browser). They become one TypeScript
module; `main.js` keeps requiring a thin `src/constants.cjs` shim that re-exports the built
values, so the server needs no change beyond that. `escHtml` disappears entirely — React
escapes by default, and every one of its call sites is a template-string `innerHTML` that
becomes JSX.

---

## 4. Phasing

Each phase is independently shippable and independently revertible (one route in `main.js`
points at either the old directory or `dist/`). Ship one, watch it in production, then start
the next.

**Phase 0 — scaffold, no behaviour change.**
Vite config with four entries, TypeScript, tokens/base CSS, `src/lib/*` ported with unit
tests, Vitest wired into CI alongside the existing `automation-tests.yml`. Nothing is served
from `dist/` yet. *Verification: `npm run build` produces four HTML files each containing the
`__P4P_ACCESS_TOKEN__` placeholder and no inline `<script>`.*

**Phase 1 — `/ranking/`.**
Smallest page (152 lines of JS, one query, no forms) and therefore the right one to prove the
whole pipeline in production: build output, token injection into a Vite-generated HTML file,
CSP with bundled Supabase, LIFF-less operation. Also fix the timezone bug noted in §6.
*Verification: side-by-side against the live page on a real device in LINE, all 24 tabs.*

**Phase 2 — `/list/`.**
Pagination, sorting, search, the mobile/desktop dual rendering. Mostly a mechanical
conversion of string templates to JSX, and it removes the largest concentration of
`innerHTML` in the codebase.

**Phase 3 — `/status/`.**
Most DOM logic (search modes, department grouping, the pending/sent `<details>` sections).
State that is currently five interdependent `style.display` assignments collapses to one
`viewMode` discriminated union — the clearest single readability win in the rewrite.

**Phase 4 — `/verify/`.**
Last, on purpose. Highest risk and lowest structural payoff: OTP, access requests, the LIFF
bind flow with its retry/fail-open/mismatch branches, and the injected-token early return.
Port it as a literal state machine (`email → code → request → bind`) with every existing
comment carried across, and test the bind branches with a mocked `/line/bind`.
*Verification: a real end-to-end bind on a device, confirmed by a new row in
`line_verified_sessions`, before the old page is deleted.*

**Phase 5 — cleanup.**
Delete `verify/`, `status/`, `list/`, `ranking/`, `assets/shared.js`, `assets/auth-guard.js`.
Tighten the CSP to `script-src 'self'`. Update `eslint.config.mjs` (the browser-globals block
and its `supabase`/`liff`/`P4P` globals become unnecessary). Update `.github/workflows` if any
reference the old paths.

**Phase 6 — optional, separate decision.** Next.js migration, if still wanted.

---

## 5. Server and deploy changes

`main.js` needs three edits, all small:

```js
// 1. templates come from the build output
const DIST = path.join(__dirname, "dist")
pageTemplates[p] = fs.readFileSync(path.join(DIST, p, "index.html"), "utf8")

// 2. same for the verify template
const verifyTemplate = fs.readFileSync(path.join(DIST, "verify", "index.html"), "utf8")

// 3. static mounts point at dist
app.use("/status", express.static(path.join(DIST, "status")))
// …and an /assets mount for Vite's hashed bundles
```

The redirect logic, cookie handling, gate RPC, and `/line/bind` are untouched.

`vercel.json`: `includeFiles` becomes `["dist/**"]`, and the build runs via a `vercel-build`
script in `package.json` (the `@vercel/node` builder executes it). *This is the one deploy-
config change that cannot be verified locally — it needs a Vercel preview deployment before
Phase 1 merges.* If `vercel-build` turns out not to fire under the legacy `builds` array, the
fallback is migrating `vercel.json` to `buildCommand` + `outputDirectory` + `rewrites`, which
is cleaner anyway but is a larger config change.

---

## 6. Bugs to fix during the port

Found while reading the current code. Each is small, and each should land as its own commit
inside the relevant phase so it is visible in the diff rather than buried in a rewrite:

- **`status/app.js:23`** — `par_sheetname` goes straight into `db.from()` with no validation.
  It should be checked against `/^\d{4}_\d{2}$/` before use.
- **`ranking/app.js:34`** — `formatTime` renders `submitted_at` in the *device's* timezone.
  Every consumer is in Thailand, but a device set to another zone silently shows wrong
  submission times on a page whose entire purpose is ordering by time. Format in
  `Asia/Bangkok` explicitly.
- **`list/app.js:37`** — `toBE(year, month)` is called with two arguments; `toBE` takes one.
  Harmless today, but it means the month-window code reads as if it does something it doesn't.
- **`status/app.js:54`** — `arr` and `count_true` are module-level mutable state that is never
  reset. Single-load pages today, so it never bites; in React it would be a bug immediately.
- **`list/app.js`** — the clock `setInterval` is never cleared. Trivial now, a leak once
  components mount and unmount.

---

## 7. Testing

| Layer | Tool | What |
|---|---|---|
| Pure logic | Vitest | `lib/months.ts` (BE conversion, the 6- and 24-month windows, the `2569_04` floor, deadline computation), department sort order, filter/sort/pagination helpers. |
| Components | Vitest + RTL | `OtpInput` (type, paste, backspace, arrows, bulk autofill), `StatusPage` view-mode transitions, `ListPage` pagination edges. |
| Bind flow | Vitest + RTL | Mocked `fetch` for `/line/bind`: success, `403 mismatch`, generic failure under the limit, failure at the limit. These four branches currently have zero coverage and are the ones that lock people out. |
| End to end | Playwright | The non-LIFF paths — desktop block, missing-token redirect to `/verify/`. Chromium is already available in CI. |

The existing `automation/test/*` suite (`node:test`) stays as it is; Vitest runs alongside it.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| LIFF breaks on a rebuilt page (fragment handling, endpoint matching). | Phase 1 ships the smallest page first purely to find this early. Test on a real device inside LINE, not a desktop emulator. |
| `@line/liff` npm package behaves differently from the CDN "edge" SDK. | Evaluate it in Phase 0. If it diverges, keep the CDN `<script>` and leave `static.line-scdn.net` in the CSP — the rewrite does not depend on this. |
| `vercel-build` doesn't run under the legacy `builds` config. | Verify on a preview deploy before Phase 1 merges; fallback documented in §5. |
| A visual regression slips through on Thai text. | Port CSS verbatim in Phases 1–4. Any redesign is a separate change, after the rewrite is complete. |
| Users mid-verification during a deploy. | Phase 4 only. Deploy outside the 1st–15th submission window, when `/verify/` traffic is lowest. |

## 9. Rough effort

| Phase | Estimate |
|---|---|
| 0 — scaffold, lib, tests, deploy verification | 1–1.5 days |
| 1 — ranking | 0.5 day |
| 2 — list | 1 day |
| 3 — status | 1–1.5 days |
| 4 — verify | 1.5–2 days |
| 5 — cleanup, CSP, lint config | 0.5 day |
| **Total** | **~6–7 days**, shippable in six independent pieces |

---

## 10. Open questions

1. **Next.js now or later?** This plan says later (§2). If the intent behind "ground-up
   rewrite" was specifically to move onto Next.js, say so and Phase 6 moves to the front —
   but the gate rewrite should still be its own phase, separate from the view layer.
2. **Is a visual redesign in scope?** This plan assumes a pixel-faithful port. `design.md`
   tokens are already applied consistently, so a redesign would be additive work with its own
   review cycle.
3. **Can `/verify/` be taken down for a short window?** A maintenance window during Phase 4
   removes most of the deployment risk from the highest-risk phase.
