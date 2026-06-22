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
  }

  global.P4P = {
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_KEY: SUPABASE_KEY,
    COLOR_ARRAY: COLOR_ARRAY,
    THAI_MONTHS: THAI_MONTHS,
    THAI_MONTHS_SHORT: THAI_MONTHS_SHORT,
    escHtml: escHtml,
  }
})(window)
