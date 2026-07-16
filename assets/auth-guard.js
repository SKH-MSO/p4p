/**
 * auth-guard.js — client half of the SERVER-side auth gate for the P4P pages
 * (status / list / ranking). Loaded after the Supabase UMD bundle + shared.js,
 * before each page's app.js.
 *
 * The server (main.js) validates the HttpOnly session cookie and injects the
 * current access token into <meta name="p4p-session"> before serving the page.
 * This script reads that token, builds the Supabase data client authenticated
 * with it (RLS enforces the allow-list) as P4P.db, reveals the page, and
 * resolves P4P.ready. There is no client-side session storage — the LINE in-app
 * browser doesn't persist one reliably, which is why validation is server-side.
 *
 * If the token is missing (page reached without the server gate) it redirects
 * to /verify/ as a fail-safe.
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
    global.location.replace("/verify/?return=" + ret + "&reason=" + P4P.BOUNCE_REASONS.NO_SESSION)
    P4P.db = null
    P4P.ready = new Promise(function () {}) // never resolves — navigating away
    return
  }

  // Keep the freshest token we have; starts as the server-injected one.
  var currentToken = at

  // Decode a JWT's exp (seconds since epoch) WITHOUT verifying — used only to
  // decide when to refresh proactively. Returns 0 if it can't be read.
  function tokenExp(t) {
    try {
      var b64 = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
      while (b64.length % 4) b64 += "="
      return JSON.parse(global.atob(b64)).exp || 0
    } catch {
      return 0
    }
  }

  // The injected token has a fixed (~1h) TTL and there is no client-side session
  // to auto-refresh it — LINE's in-app webview can't persist one, which is the
  // whole reason auth is server-side. Without this, a page left open past expiry
  // starts failing every query with 401 and no way to recover. Instead, ask the
  // server for a fresh token: GET /auth/token re-derives one from the HttpOnly
  // session cookie (refreshing against Supabase if needed). Single-flighted so
  // parallel queries share one in-flight request rather than each refreshing.
  var refreshing = null
  function clearRefreshing() { refreshing = null }
  function refreshToken() {
    if (!refreshing) {
      refreshing = global
        .fetch("/auth/token", { headers: { Accept: "application/json" } })
        .then(function (r) {
          if (r.status === 401) {
            // Session is genuinely gone server-side (cookie missing/expired) —
            // NOT a transient error. Recover exactly like a missing token on
            // first load: send the user to re-verify, instead of leaving them
            // on a page that 401s every query and re-hits /auth/token on each
            // one. Return a never-resolving promise so no query proceeds on the
            // dead token while the browser navigates away.
            var ret = encodeURIComponent(global.location.pathname + global.location.search + global.location.hash)
            global.location.replace("/verify/?return=" + ret + "&reason=" + P4P.BOUNCE_REASONS.EXPIRED)
            return new Promise(function () {})
          }
          if (!r.ok) throw new Error("token endpoint " + r.status)
          return r.json().then(function (j) {
            if (j && j.access_token) currentToken = j.access_token
            return currentToken
          })
        })
        .catch(function () {
          // Transient (network / 5xx): keep the old token so the query's own
          // 401 surfaces the real failure instead of this masking it.
          return currentToken
        })
      // Reset the in-flight marker once settled (no .finally, for older webviews).
      refreshing.then(clearRefreshing, clearRefreshing)
    }
    return refreshing
  }

  // Data client authenticated with the user token. supabase-js calls this
  // accessToken provider before every request; we return the current token,
  // refreshing first whenever it's within 60s of expiry.
  P4P.db = global.supabase.createClient(P4P.SUPABASE_URL, P4P.SUPABASE_KEY, {
    accessToken: function () {
      if (tokenExp(currentToken) < Date.now() / 1000 + 60) return refreshToken()
      return Promise.resolve(currentToken)
    },
  })
  reveal()
  P4P.ready = Promise.resolve(true)
})(window)
