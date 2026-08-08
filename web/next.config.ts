import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // ── DO NOT SET `trailingSlash` ────────────────────────────────────────────
  // Whichever value you pick, Next canonicalises the other form with a 308
  // redirect. That redirect is the exact failure mode that took /verify/ down
  // in 2026-08: LINE completes a LIFF login by navigating to the app's
  // registered Endpoint URL with "#access_token=…" appended, and a redirect
  // whose Location carries a fragment of its own replaces LIFF's. liff.init()
  // then finds no login state, restarts login, and loops forever inside the
  // LINE webview with no way out for the physician.
  //
  // /verify and /verify/ must therefore BOTH render, with no navigation
  // between them. That is done with a middleware rewrite (internal, no
  // Location header, no fragment involved) — see middleware.ts in Phase 1.
  //
  // The OTHER three pages do still want their trailing-slash redirect WITH a
  // literal "#", because there the goal is the opposite: clearing a stale
  // fragment left behind by a different LIFF app. That is also middleware, and
  // is deliberately hand-written rather than delegated to this flag, because
  // the two cases need opposite behaviour.
  //
  // See ../REACT_REWRITE_PLAN.md §2 and the comments in ../main.js servePage().

  poweredByHeader: false,

  // The repo root has its own package-lock.json (the Express app), so the
  // bundler otherwise warns that it cannot tell which project it is building.
  // Pin it to this directory.
  turbopack: {
    root: __dirname,
  },

  // Hands trailing-slash handling entirely to middleware.ts.
  //
  // Next's built-in normalisation redirects one form to the other, and the two
  // halves of this app need OPPOSITE behaviour: /status wants a redirect to
  // /status/ WITH a literal "#" appended (to clear a stale fragment from
  // another LIFF app), while /verify and /verify/ must both render with no
  // redirect at all (a redirect destroys LIFF's login fragment). No single
  // value of `trailingSlash` expresses that, so it is done by hand.
  skipTrailingSlashRedirect: true,
}

export default nextConfig
