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

  // Every gated page carries a per-request access token and a per-request CSP
  // nonce, so nothing here can be statically optimised or served from a CDN
  // cache. Made explicit so a future "why is this not cached?" has an answer.
  //
  // NOTE: this does not by itself force dynamic rendering — the pages declare
  // that themselves. It only stops Next from trying to prerender at build time
  // in a way that would bake in a placeholder token.
  experimental: {
    // Placeholder for Phase 1. Intentionally empty right now so the scaffold
    // builds with stock behaviour and nothing is enabled without a reason.
  },
}

export default nextConfig
