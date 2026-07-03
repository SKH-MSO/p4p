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

  // /verify/ hands off a freshly-verified session via #p4p_at=...&p4p_rt=...
  // instead of relying solely on this page reading /verify/'s localStorage
  // write — some in-app browsers don't reliably carry storage across a full
  // page navigation. If present, consume it (setSession persists it fresh in
  // THIS page's own context) and strip it from the URL immediately.
  function consumeHandoff() {
    var hash = global.location.hash
    if (!hash || hash.indexOf("p4p_at=") === -1) return null
    var params = new URLSearchParams(hash.replace(/^#/, ""))
    var at = params.get("p4p_at")
    var rt = params.get("p4p_rt")
    if (!at || !rt) return null
    try {
      global.history.replaceState(null, "", global.location.pathname + global.location.search)
    } catch (e) { /* non-fatal — worst case the tokens stay visible in the URL */ }
    return { access_token: at, refresh_token: rt }
  }

  var handoff = consumeHandoff()
  var sessionPromise = handoff ? db.auth.setSession(handoff) : db.auth.getSession()

  // Resolves true only when a session is present. On no-session it redirects
  // and leaves the promise unresolved so callers gated on it never load data.
  // reason "handoff_failed" = a fresh OTP handoff arrived but setSession()
  // rejected it (session establishment itself is failing, not storage).
  // reason "no_session" = no handoff was present and there's simply no
  // existing session (the everyday case for a first-time / logged-out visit).
  P4P.ready = sessionPromise
    .then(function (res) {
      if (res && res.data && res.data.session) {
        reveal()
        return true
      }
      if (res && res.error) {
        console.error("P4P auth-guard: session check returned an error:", res.error)
      }
      toVerify(handoff ? "handoff_failed" : "no_session")
      return new Promise(function () {}) // never resolves — we're navigating away
    })
    .catch(function (err) {
      // Fail closed: any error checking the session sends the visitor to verify.
      console.error("P4P auth-guard: session check threw:", err)
      toVerify("check_error")
      return new Promise(function () {})
    })
})(window)
