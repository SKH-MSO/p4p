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

  // Single client for the whole page. We do NOT use supabase-js session
  // persistence (broken in LINE's webview); instead we read the tokens WE saved
  // in a cookie (shared.js) and hydrate this page's client in memory via
  // setSession() below.
  var db = global.supabase.createClient(P4P.SUPABASE_URL, P4P.SUPABASE_KEY, P4P.SUPABASE_OPTS)
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

  // `reason` is a short, fixed, non-sensitive code (never raw error text/tokens)
  // that /verify/ can show on-page. LINE's in-app browser hides the address bar,
  // so this is the only way to see WHY we bounced without a computer + cable.
  function toVerify(reason) {
    var ret = encodeURIComponent(
      global.location.pathname + global.location.search + global.location.hash
    )
    var url = "/verify/?return=" + ret
    if (reason) url += "&reason=" + encodeURIComponent(reason)
    global.location.replace(url)
  }

  // Read the tokens we persisted ourselves. No cookie / expired -> verify.
  // Otherwise hydrate THIS page's client in memory with setSession() so its
  // queries carry the user's JWT (RLS). We never depend on supabase-js having
  // persisted anything across the navigation. ?reason= is visible on /verify/
  // (LINE hides the address bar): no_session / expired / check_error.
  var saved = P4P.readSession()
  if (!saved) {
    toVerify("no_session")
    P4P.ready = new Promise(function () {})
  } else if (P4P.sessionExpired(saved)) {
    P4P.clearSession()
    toVerify("expired")
    P4P.ready = new Promise(function () {})
  } else {
    P4P.ready = db.auth
      .setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token })
      .then(function (res) {
        if (res && res.data && res.data.session) {
          reveal()
          return true
        }
        if (res && res.error) console.error("P4P auth-guard: setSession error:", res.error)
        toVerify("persist")
        return new Promise(function () {})
      })
      .catch(function (err) {
        console.error("P4P auth-guard: setSession threw:", err)
        toVerify("check_error")
        return new Promise(function () {})
      })
  }
})(window)
