# `web/` — Next.js rewrite of the P4P LIFF front end

Implements [`../REACT_REWRITE_PLAN.md`](../REACT_REWRITE_PLAN.md). **Nothing here is
deployed yet.** Production is still served by `../main.js` (Express), and this directory is
built and tested in isolation until the cutover in Phase 6.

It is a self-contained sub-project with its own `package.json`, matching the existing
convention in `../automation/` and `../process/`. That isolation is deliberate: the live
Vercel deployment builds from the repo root, so adding a framework there could change how
production is built. Nothing in this directory can affect it.

## Commands

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

No lint script yet: Next 16 removed `next lint`, and the root `eslint.config.mjs` ignores this
directory (no TypeScript parser). `typecheck` plus `build` cover the same ground for now;
wiring up `typescript-eslint` is worth doing but has not been done.

## Status

| Phase | State |
|---|---|
| 0 — scaffold, tokens, shared lib, tests | **done** (this directory) |
| 1 — gate, middleware, CSP nonce, webhooks | not started |
| 1a — `/admin/` dashboard | not started — **unblocked, can start now** |
| 2 — design system + `/status/` | not started |
| 3 — `/list/` | not started |
| 4 — `/ranking/` | not started |
| 5 — `/verify/` | not started |
| 6 — cutover | not started |
| 7 — decommission Express | not started |

Phase 1a is the only page that needs neither a staging LIFF app nor the redesign sign-off —
`/admin/` uses no LIFF and runs in a plain mobile browser. It can proceed while both blockers
below are outstanding. See plan §1a.

### Blocked on someone with LINE Developers console access

Phase 0 cannot be *verified* without this, and every later phase depends on it:

**Register four staging LIFF apps** whose Endpoint URLs point at a stable Vercel preview
alias, mirroring the four production apps. A LIFF app only runs at its registered URL, so
without these the first real test of any change is in production, in front of every
physician. See plan §5.

Once they exist, open `https://<preview>/preflight?liffId=<staging-liff-id>` inside LINE.
That page reports whether `liff.init()` succeeds with the npm SDK and — the check that
matters most — whether `liff.getIDToken()` returns a token. It returns `null` unless the
LIFF app has the **`openid`** scope, and that one missing scope is what broke the bind flow
in 2026-08.

### Blocked on a design decision

Phase 2 needs sign-off on the redesign direction before three of the four pages get built.
Suggested gate: one annotated `/status/` screen. See plan §4.

## What is here

```
app/
  layout.tsx           html lang="th", self-hosted fonts, viewport
  globals.css          design tokens from ../design.md — one definition, not four
  page.tsx             placeholder root, replaced in Phases 2–5
  preflight/           Phase 0 diagnostic page (delete in Phase 7)
lib/
  months.ts            BE conversion, month keys, month windows, deadlines, Bangkok time
  colors.ts            month accent colours
  departments.ts       department order, labels, name joining
  __tests__/           42 tests, including the parity guard below
```

### The parity guard

`lib/__tests__/parity.test.ts` reads the legacy sources directly and asserts they still agree
with `lib/`:

| Legacy source | What is duplicated |
|---|---|
| `../src/constants.cjs` | month colours, Thai month names, the 6-month window |
| `../assets/shared.js` | month colours, Thai month names (long + short) |
| `../status/app.js` | the department list and its Thai ordering |
| `../admin/app.js` | the department list again — a third copy |

None of these can be deleted until Express is retired. A colour changed in one place would
show up as a month tab whose accent no longer matches the LINE message that linked to it; a
department spelled differently in `admin/app.js` would let the admin save a value the status
page then fails to group.

If that test fails, the fix is to change all three, not to loosen the test. Delete the file
in Phase 7 along with the legacy sources.

## Findings from building the scaffold

**Next.js emits inline `<script>` tags.** Verified against the build output: every page has
two, with no `src` and no nonce. The current app's CSP has *no* `unsafe-inline` on
`script-src` — a deliberate property earned by moving all page JS to external files. So a
naive migration would silently weaken it. The per-request nonce described in plan §6 is a
Phase 1 requirement, not cleanup.

**`next/font` works and removes two CSP origins.** Manrope, Work Sans and Noto Sans Thai
Looped are downloaded at build time and served from our own origin, so
`fonts.googleapis.com` and `fonts.gstatic.com` drop out of the CSP along with two
preconnects and a render-blocking round trip.

**TypeScript is pinned to 5.x, not 7.** TypeScript 7 (the Go-based compiler) is released but
not something to bet a migration on mid-flight. Revisit after cutover.

**`@line/liff` installs cleanly from npm**, but that only proves it builds. Whether it
behaves like the CDN "edge" SDK inside LINE's webview is exactly what `/preflight` is for,
and that answer needs the staging LIFF apps above.
