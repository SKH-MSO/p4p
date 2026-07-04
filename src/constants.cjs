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
const MONTH_ITERATOR = [
  [[0, 0], [11, -1], [10, -1], [9, -1], [8, -1], [7, -1]],
  [[1, 0], [0, 0], [11, -1], [10, -1], [9, -1], [8, -1]],
  [[2, 0], [1, 0], [0, 0], [11, -1], [10, -1], [9, -1]],
  [[3, 0], [2, 0], [1, 0], [0, 0], [11, -1], [10, -1]],
  [[4, 0], [3, 0], [2, 0], [1, 0], [0, 0], [11, -1]],
  [[5, 0], [4, 0], [3, 0], [2, 0], [1, 0], [0, 0]],
  [[6, 0], [5, 0], [4, 0], [3, 0], [2, 0], [1, 0]],
  [[7, 0], [6, 0], [5, 0], [4, 0], [3, 0], [2, 0]],
  [[8, 0], [7, 0], [6, 0], [5, 0], [4, 0], [3, 0]],
  [[9, 0], [8, 0], [7, 0], [6, 0], [5, 0], [4, 0]],
  [[10, 0], [9, 0], [8, 0], [7, 0], [6, 0], [5, 0]],
  [[11, 0], [10, 0], [9, 0], [8, 0], [7, 0], [6, 0]],
]

// Sheet keys (YYYY_MM, BE year) to render as disabled in the month-picker rich
// menu: no label text, no tap action. Used for months whose roster data is
// known to be broken/incomplete, so the bot doesn't send people to a status
// page that can't show anything useful. Remove the key once the data is fixed
// (or it'll age out on its own once the rolling 6-month window passes it).
const DISABLED_SHEETS = new Set(["2569_02"])

module.exports = { COLOR_ARRAY, MONTH_NAMES, MONTH_ITERATOR, DISABLED_SHEETS }
