/**
 * Shared browser constants + helpers for the P4P LIFF pages
 * (status / list / ranking).
 *
 * Loaded as a plain (synchronous) script BEFORE each page's inline script,
 * so everything here is available on window.P4P by the time the page runs.
 */
(function (global) {
  "use strict"

  // Supabase project. This is the PUBLISHABLE (anon) key — safe to expose in
  // the browser; the data is protected by Row Level Security (see
  // scripts/security-rls.sql). Single source of truth for all three pages.
  var SUPABASE_URL = "https://zjeizbrzcltkgtlmkbji.supabase.co"
  var SUPABASE_KEY = "sb_publishable_TcCSpznim4fi0Y7E_zuAsg_op19VZQ-"

  // Month accent colors, index 0 = January: [tailwindClass, hex]
  var COLOR_ARRAY = [
    ["bg-red-300", "#ffa2a2"],
    ["bg-orange-300", "#ffb86a"],
    ["bg-yellow-300", "#ffdf20"],
    ["bg-lime-300", "#bbf451"],
    ["bg-green-300", "#7bf1a8"],
    ["bg-teal-300", "#46ecd5"],
    ["bg-cyan-300", "#53eafd"],
    ["bg-sky-300", "#74d4ff"],
    ["bg-blue-300", "#8ec5ff"],
    ["bg-indigo-300", "#a3b3ff"],
    ["bg-violet-300", "#c4b4ff"],
    ["bg-fuchsia-300", "#f4a8ff"],
  ]

  // Full Thai month names, index 0 = January.
  var THAI_MONTHS = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
  ]

  // Abbreviated Thai month names, index 0 = January.
  var THAI_MONTHS_SHORT = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
  ]

  // Escape text before inserting it into innerHTML (prevents HTML/script injection).
  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;") // also safe inside single-quoted attributes
  }

  // ── Cookie-backed storage for the Supabase auth session ──────────────────
  // LINE's in-app (LIFF) browser does NOT reliably persist localStorage across
  // full page navigations — a session written on /verify/ was gone by the time
  // status/list/ranking loaded, causing an endless redirect back to /verify/.
  // Cookies survive where localStorage doesn't, so we point Supabase's auth
  // `storage` at this adapter (used identically by auth-guard.js and the verify
  // page, so the session written by one is read by the others).
  //
  // A Supabase session JSON can exceed a single cookie's ~4KB limit, so values
  // are split into chunks: the base name holds the chunk COUNT, and <name>.<i>
  // holds each URL-encoded chunk. Each raw chunk is encoded independently so a
  // split never lands mid-escape-sequence.
  var COOKIE_ATTRS = "; path=/; max-age=34560000; samesite=lax; secure" // ~400 days
  var CHUNK = 1800 // raw chars/chunk; encoded stays well under the 4KB cookie cap

  function rawRead(name) {
    var m = document.cookie.match(
      new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\+^])/g, "\\$1") + "=([^;]*)")
    )
    return m ? m[1] : null
  }
  function rawWrite(name, encodedValue) {
    document.cookie = name + "=" + encodedValue + COOKIE_ATTRS
  }
  function expire(name) {
    document.cookie = name + "=; path=/; max-age=0; samesite=lax; secure"
  }

  var cookieStorage = {
    getItem: function (key) {
      var head = rawRead(key)
      if (head === null) return null
      var n = parseInt(decodeURIComponent(head), 10)
      if (!isFinite(n) || n < 1) return null
      var out = ""
      for (var i = 0; i < n; i++) {
        var part = rawRead(key + "." + i)
        if (part === null) return null // incomplete — treat as missing
        out += decodeURIComponent(part)
      }
      return out
    },
    setItem: function (key, value) {
      cookieStorage.removeItem(key) // clear any previous (possibly longer) value
      value = String(value)
      var n = Math.max(1, Math.ceil(value.length / CHUNK))
      rawWrite(key, encodeURIComponent(String(n)))
      for (var i = 0; i < n; i++) {
        rawWrite(key + "." + i, encodeURIComponent(value.slice(i * CHUNK, (i + 1) * CHUNK)))
      }
    },
    removeItem: function (key) {
      var head = rawRead(key)
      if (head !== null) {
        var n = parseInt(decodeURIComponent(head), 10)
        if (isFinite(n)) for (var i = 0; i < n; i++) expire(key + "." + i)
      }
      expire(key)
    },
  }

  // Options every Supabase client in this app should share so the auth session
  // persists in cookies. Pass as the 3rd arg to supabase.createClient(...).
  var SUPABASE_OPTS = {
    auth: {
      storage: cookieStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  }

  global.P4P = {
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_KEY: SUPABASE_KEY,
    SUPABASE_OPTS: SUPABASE_OPTS,
    COOKIE_STORAGE: cookieStorage,
    COLOR_ARRAY: COLOR_ARRAY,
    THAI_MONTHS: THAI_MONTHS,
    THAI_MONTHS_SHORT: THAI_MONTHS_SHORT,
    escHtml: escHtml,
  }
})(window)
