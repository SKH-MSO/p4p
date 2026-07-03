/**
 * auth-guard.js — client half of the SERVER-side auth gate for the P4P pages
 * (status / list / ranking). Loaded after the Supabase UMD bundle + shared.js,
 * before each page's app.js.
 *
 * The server (main.js) validates the HttpOnly session cookie and injects the
 * current access token into <meta name="p4p-session"> before serving the page.
 * This script reads that token, builds the Supabase data client authenticated
 * with it (RLS enforces the allow-list) as P4P.db, reveals the page, and
 * resolves P4P.ready. No client-side session storage.
 *
 * It also surfaces any script error as an on-screen banner, because LINE's
 * in-app browser has no console/URL bar to debug with.
 */
(function (global) {
  "use strict"

  var P4P = global.P4P || (global.P4P = {})

  // On-screen error banner (no console in LIFF).
  function banner(msg) {
    try {
      var d = document.getElementById("p4p-err")
      if (!d) {
        d = document.createElement("div")
        d.id = "p4p-err"
        d.style.cssText =
          "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#c0392b;" +
          "color:#fff;font:11px/1.4 monospace;padding:6px 8px;white-space:pre-wrap;word-break:break-all"
        ;(document.body || document.documentElement).appendChild(d)
      }
      d.textContent = "ERR: " + msg
      document.documentElement.classList.remove("p4p-unverified") // make sure it's visible
    } catch (e) { /* nothing more we can do */ }
  }
  global.addEventListener("error", function (e) {
    banner((e.message || "error") + "  @" + String(e.filename || "").split("/").pop() + ":" + e.lineno)
  })
  global.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason
    banner("promise: " + ((r && r.message) || r))
  })

  // Hide the body until we confirm a token is present.
  var style = document.createElement("style")
  style.textContent = "html.p4p-unverified body{visibility:hidden!important}"
  ;(document.head || document.documentElement).appendChild(style)
  document.documentElement.classList.add("p4p-unverified")

  function reveal() {
    document.documentElement.classList.remove("p4p-unverified")
  }

  var D = global.P4PDIAG || function () {}
  D("guard: start")

  var meta = document.querySelector('meta[name="p4p-session"]')
  var at = meta ? (meta.getAttribute("content") || "") : ""
  D("guard: meta " + (meta ? "found" : "MISSING") + ", token " +
    (!at ? "EMPTY" : at === "__P4P_ACCESS_TOKEN__" ? "UNFILLED-PLACEHOLDER" : "present(len " + at.length + ")"))

  if (!at || at === "__P4P_ACCESS_TOKEN__") {
    // Fail-safe: the server should have redirected already, but if not, do it.
    D("guard: no token -> redirecting to /verify", true)
    var ret = encodeURIComponent(global.location.pathname + global.location.search + global.location.hash)
    global.location.replace("/verify/?return=" + ret + "&reason=no_session")
    P4P.db = null
    P4P.ready = new Promise(function () {}) // never resolves — navigating away
    return
  }

  // Build the data client authenticated with the injected user token. Prefer the
  // supabase-js `accessToken` provider; if this build doesn't support it, fall
  // back to a plain Authorization header.
  try {
    P4P.db = global.supabase.createClient(P4P.SUPABASE_URL, P4P.SUPABASE_KEY, {
      accessToken: function () { return Promise.resolve(at) },
    })
  } catch (err) {
    banner("createClient(accessToken): " + (err && err.message))
    try {
      P4P.db = global.supabase.createClient(P4P.SUPABASE_URL, P4P.SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: "Bearer " + at } },
      })
    } catch (e2) {
      banner("createClient(fallback): " + (e2 && e2.message))
      P4P.db = null
    }
  }

  D("guard: client " + (P4P.db ? "created" : "NULL") + " -> revealing + resolving P4P.ready")
  reveal()
  P4P.ready = Promise.resolve(true) // always set, so pages' load code runs (and surfaces its own errors)
})(window)
