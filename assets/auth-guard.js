/**
 * auth-guard.js — client half of the SERVER-side auth gate for the P4P pages
 * (status / list / ranking). Loaded after the Supabase UMD bundle + shared.js,
 * before each page's app.js.
 *
 * The server (main.js) validates the HttpOnly session cookie on every page
 * request and injects the current access token into
 *   <meta name="p4p-session" content="...">
 * before serving the HTML. This script just:
 *   1. reads that token,
 *   2. builds the Supabase data client authenticated with it (RLS enforces the
 *      allow-list), exposed as P4P.db,
 *   3. reveals the page and resolves P4P.ready.
 * There is NO client-side session storage — the LINE in-app browser doesn't
 * persist one reliably, which is why validation lives on the server.
 *
 * If the token is missing (e.g. the page was somehow reached without the server
 * gate) it redirects to /verify/ as a fail-safe.
 */
(function (global) {
  "use strict"

  var P4P = global.P4P || (global.P4P = {})

  // Hide the body until we confirm a token is present.
  var style = document.createElement("style")
  style.textContent = "html.p4p-unverified body{visibility:hidden!important}"
  ;(document.head || document.documentElement).appendChild(style)
  document.documentElement.classList.add("p4p-unverified")

  function reveal() {
    document.documentElement.classList.remove("p4p-unverified")
  }

  var meta = document.querySelector('meta[name="p4p-session"]')
  var at = meta ? (meta.getAttribute("content") || "") : ""

  if (!at || at === "__P4P_ACCESS_TOKEN__") {
    // Fail-safe: the server should have redirected already, but if not, do it.
    var ret = encodeURIComponent(global.location.pathname + global.location.search + global.location.hash)
    global.location.replace("/verify/?return=" + ret + "&reason=no_session")
    P4P.db = null
    P4P.ready = new Promise(function () {}) // never resolves — navigating away
    return
  }

  // Data client authenticated with the injected user token. The `accessToken`
  // provider is the supported way to bring your own token — supabase-js uses it
  // for every request and disables its own (unused) session handling.
  P4P.db = global.supabase.createClient(P4P.SUPABASE_URL, P4P.SUPABASE_KEY, {
    accessToken: function () { return Promise.resolve(at) },
  })
  reveal()
  P4P.ready = Promise.resolve(true)
})(window)
