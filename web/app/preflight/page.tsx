import PreflightClient from "./PreflightClient"

/**
 * Phase 0 exit criterion: a page that proves this app can be opened inside
 * LINE from a staging LIFF app, and that reports what the environment actually
 * supports before any real page is built on top of it.
 *
 * It answers three questions the plan flags as unknowns
 * (../../REACT_REWRITE_PLAN.md §3, §5, §11):
 *
 *   1. Does the npm `@line/liff` package behave like the CDN "edge" SDK the
 *      legacy pages load? If not, the fallback is the CDN <script> tag at the
 *      cost of one CSP origin, and we want to know that now rather than in
 *      Phase 5.
 *   2. Does liff.getIDToken() return a token? It returns null unless the LIFF
 *      app has the `openid` scope, and that single missing scope is what broke
 *      the bind flow in 2026-08. The whole second factor depends on it.
 *   3. Does the login fragment survive arriving at this page?
 *
 * Open it as https://<preview>/preflight?liffId=<staging-liff-id> so one page
 * can check all four staging apps.
 *
 * DELETE THIS PAGE at Phase 7. It is a migration tool, not a feature — it
 * deliberately reports diagnostics rather than gating on anything.
 */
export const dynamic = "force-dynamic"

export default function PreflightPage() {
  return <PreflightClient />
}
