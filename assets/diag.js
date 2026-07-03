/**
 * diag.js — TEMPORARY on-screen step logger for debugging the LIFF data pages.
 * Loaded FIRST (before supabase/shared/auth-guard), so it captures errors and
 * step reports even if a later script fails. Remove once the pages load.
 *
 * Other scripts call window.P4PDIAG("message") to append a line; errors and
 * unhandled promise rejections are captured automatically. The panel is
 * attached to <html> (not <body>) and forces itself visible, so it shows even
 * while auth-guard has the body hidden.
 */
(function (g) {
  "use strict"
  var log = []
  var el = null
  function render() {
    if (!el) {
      el = document.createElement("div")
      el.id = "p4p-diag"
      el.style.cssText =
        "position:fixed;left:0;right:0;bottom:0;max-height:50vh;overflow:auto;" +
        "z-index:2147483647;background:rgba(18,14,10,.95);color:#8fef8f;" +
        "font:11px/1.45 monospace;padding:6px 8px;white-space:pre-wrap;word-break:break-all"
      ;(document.documentElement || document.body).appendChild(el)
    }
    el.textContent = log.join("\n")
  }
  g.P4PDIAG = function (msg, bad) {
    log.push((bad ? "✗ " : "• ") + msg)
    try { render() } catch (e) { /* ignore */ }
  }
  g.addEventListener("error", function (e) {
    g.P4PDIAG("JS ERROR: " + (e.message || (e.error && e.error.message) || "?") +
      " @" + String(e.filename || "").split("/").pop() + ":" + (e.lineno || "?"), true)
  })
  g.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason
    g.P4PDIAG("PROMISE REJECT: " + ((r && r.message) || r), true)
  })
  // Force the body visible even if auth-guard hides it, so the panel shows.
  try {
    var s = document.createElement("style")
    s.textContent = "html.p4p-unverified body{visibility:visible!important}"
    ;(document.head || document.documentElement).appendChild(s)
  } catch (e) { /* ignore */ }
  g.P4PDIAG("diag loaded  path=" + location.pathname + location.search.slice(0, 40))
})(window)
