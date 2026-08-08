/**
 * Hospital departments and their display order.
 *
 * Ported from `dep_array` / `sortDeps` in status/app.js. The order is a
 * hand-maintained Thai dictionary ordering, not something localeCompare
 * reproduces on its own, which is why the list is hardcoded rather than sorted.
 */

/** Display order. Anything not listed sorts after these, alphabetically. */
export const DEPARTMENTS = [
  "กุมารเวชกรรม",
  "จักษุวิทยา",
  "จิตเวชและยาเสพติด",
  "เทคนิคการแพทย์และพยาธิวิทยาคลินิก",
  "นิติเวช",
  "ผู้ป่วยนอก",
  "พยาธิวิทยากายวิภาค",
  "รังสีวิทยา",
  "วิสัญญีวิทยา",
  "เวชกรรมฟื้นฟู",
  "เวชกรรมสังคม",
  "เวชศาสตร์ฉุกเฉิน",
  "ศัลยกรรม",
  "ศัลยกรรมออร์โธปิดิกส์",
  "สูติ-นรีเวชกรรม",
  "โสต ศอ นาสิก",
  "อาชีวเวชกรรม",
  "อายุรกรรม",
  "INTERN",
] as const

/**
 * Sort departments into display order: known ones first in DEPARTMENTS order,
 * then any unknown ones alphabetically (Thai collation).
 *
 * Does not mutate the input.
 */
export function sortDepartments(list: readonly string[]): string[] {
  const order = (d: string): number => DEPARTMENTS.indexOf(d as (typeof DEPARTMENTS)[number])
  return [...list].sort((a, b) => {
    const ia = order(a)
    const ib = order(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b, "th")
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

/**
 * How a department is labelled in the UI: prefixed with "กลุ่มงาน" (department
 * / work group), except INTERN which stands alone.
 */
export function departmentLabel(department: string): string {
  return department === "INTERN" ? "INTERN" : `กลุ่มงาน${department}`
}

/** Join a physician's name parts, skipping missing ones. */
export function fullName(
  firstname: string | null | undefined,
  lastname: string | null | undefined,
): string {
  return [firstname, lastname].filter(Boolean).join(" ")
}
