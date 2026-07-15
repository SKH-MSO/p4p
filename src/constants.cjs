// Shared month/color constants used by the server (main.js) and the rich-menu
// build script (scripts/update-month-picker.mjs).
//
// CommonJS so main.js can require() it directly; the ESM script loads it via
// createRequire. Keeping it here means a month/color tweak is a single edit.

// Month accent colors, index 0 = January: [tailwindClass, hex]
const COLOR_ARRAY = [
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
const MONTH_NAMES = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
]

// For a given current month (0-11), the six months to display (most recent
// first), as [monthIndex, yearOffset] pairs.
//
// Derived rather than hand-written: this used to be a manually-maintained
// 12x6 matrix of tuples (72 numbers) — easy to typo on an edit and hard to
// verify by eye. It's fully determined by one rule: the i-th most-recent
// month before month `m` is (m - i) mod 12, crossing into the previous
// calendar year (yearOffset -1) whenever m - i is negative.
const MONTH_ITERATOR = Array.from({ length: 12 }, (_, m) =>
  Array.from({ length: 6 }, (_, i) => [
    ((m - i) % 12 + 12) % 12,
    (m - i) < 0 ? -1 : 0,
  ])
)

// ── LINE-bind gate constants (server side) ──────────────────────────────────
// How many failed LINE-userId bind attempts are allowed before a physician is
// let through anyway (with a one-time admin alert). This SAME number lives in
// three runtimes that cannot share a module: here (server, main.js), the
// browser (assets/shared.js → P4P.BIND_ATTEMPT_LIMIT), and Postgres
// (scripts/line-bind-gate.sql, the `>= 3` in record_bind_failure). Keep all
// three in sync; the SQL check is the ultimate authority.
const BIND_ATTEMPT_LIMIT = 3

// Reasons the server bounces a request to /verify/ (the ?reason= query value).
// String-matched on both sides — main.js sets them, and the browser
// (verify/app.js via P4P.BOUNCE_REASONS) reads them back — so a bare literal
// typo in either half fails silently. Mirror any change in assets/shared.js.
const BOUNCE_REASONS = {
  NO_SESSION: "no_session", // everyday logged-out case (stays silent client-side)
  EXPIRED: "expired", // session lapsed / refresh failed
  BLOCKED: "blocked", // email is on the denylist (blocked_emails)
  BIND_REQUIRED: "bind_required", // valid session, LINE userId not yet bound
}

module.exports = { COLOR_ARRAY, MONTH_NAMES, MONTH_ITERATOR, BIND_ATTEMPT_LIMIT, BOUNCE_REASONS }
