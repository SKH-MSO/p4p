/**
 * auth-guard.js — email-verification gate for the P4P LIFF pages
 * (status / list / ranking).
 *
 * Loaded AFTER the Supabase UMD bundle and /assets/shared.js, but BEFORE each
 * page's own inline script. It:
 *
 *   1. Creates the single Supabase client for the page and exposes it as
 *      `P4P.db` (pages reuse this instead of calling createClient themselves,
 *      so the persisted auth session is shared and there is only one client).
 *   2. Hides the page body until we know the visitor holds a verified session,
 *      preventing a flash of protected content before any redirect.
 *   3. Exposes `P4P.ready` — a promise that resolves to `true` once a valid
 *      Supabase session is loaded (and its access token is attached to the
 *      client, so data queries will pass Row Level Security). When there is no
 *      session it redirects to /verify/ and the promise stays pending, so the
 *      page's data load never fires.
 *
 * NOTE: this redirect is only the *cosmetic* half of the gate. The real
 * protection is RLS requiring an authenticated + allow-listed session — see
 * scripts/security-rls-auth.sql. Without that SQL applied, the anon key can
 * still read the tables directly regardless of this script.
 */
(function (global) {
  "use strict"

  var P4P = global.P4P || (global.P4P = {})

  // Single client for the whole page. persistSession/autoRefreshToken default
  // to true, so the session survives navigation between the three pages
  // (same origin => same localStorage).
  var db = global.supabase.createClient(P4P.SUPABASE_URL, P4P.SUPABASE_KEY)
  P4P.db = db

  // Hide the body until verified. Using visibility (not display) keeps layout
  // intact so revealing is instant and flicker-free.
  var style = document.createElement("style")
  style.textContent = "html.p4p-unverified body{visibility:hidden!important}"
  ;(document.head || document.documentElement).appendChild(style)
  document.documentElement.classList.add("p4p-unverified")

  function reveal() {
    document.documentElement.classList.remove("p4p-unverified")
  }

  function toVerify() {
    var ret = encodeURIComponent(
      global.location.pathname + global.location.search + global.location.hash
    )
    global.location.replace("/verify/?return=" + ret)
  }

  // Resolves true only when a session is present. On no-session it redirects
  // and leaves the promise unresolved so callers gated on it never load data.
  P4P.ready = db.auth
    .getSession()
    .then(function (res) {
      if (res && res.data && res.data.session) {
        reveal()
        return true
      }
      toVerify()
      return new Promise(function () {}) // never resolves — we're navigating away
    })
    .catch(function () {
      // Fail closed: any error checking the session sends the visitor to verify.
      toVerify()
      return new Promise(function () {})
    })
})(window)
