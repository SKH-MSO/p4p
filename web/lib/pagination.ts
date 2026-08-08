/**
 * Page-number ranges with ellipses, ported from list/app.js.
 *
 * Pure and separately testable — the legacy version was two dense one-liners
 * with an off-by-one guard bolted on, and the edge cases were never exercised.
 */

export type PageToken = number | "…"

export function pageRange(current: number, total: number): PageToken[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  if (current <= 4) return [1, 2, 3, 4, 5, "…", total]
  if (current >= total - 3) return [1, "…", total - 4, total - 3, total - 2, total - 1, total]
  return [1, "…", current - 1, current, current + 1, "…", total]
}

export function pageRangeMobile(current: number, total: number): PageToken[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)
  if (current <= 2) return [1, 2, 3, "…", total]
  if (current >= total - 1) return [1, "…", total - 2, total - 1, total]
  return [1, "…", current, "…", total]
}
