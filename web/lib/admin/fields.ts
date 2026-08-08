import { BANGKOK_TZ } from "../months"
import type { RosterColumn } from "./roster"

/**
 * Form-field behaviour for the schema-agnostic admin CRUD.
 *
 * The dashboard generates its fields from live column introspection, so none of
 * this may hardcode today's columns — a new month is provisioned with whatever
 * shape provision_month() gives it.
 */

export function isTimestampType(dataType: string | undefined): boolean {
  return /timestamp/i.test(dataType ?? "")
}

export function isNumericType(dataType: string | undefined): boolean {
  return /double precision|numeric|integer|real|bigint/i.test(dataType ?? "")
}

export function inputTypeFor(column: RosterColumn): "datetime-local" | "number" | "text" {
  if (isTimestampType(column.data_type)) return "datetime-local"
  if (isNumericType(column.data_type)) return "number"
  return "text"
}

const pad2 = (n: number) => String(n).padStart(2, "0")

/**
 * ISO timestamp -> the "YYYY-MM-DDTHH:mm" a datetime-local input wants,
 * expressed in BANGKOK time.
 *
 * The legacy version used getFullYear()/getHours(), i.e. the device's timezone.
 * Display and save were exact inverses so an untouched field round-tripped
 * losslessly, but an admin on a non-Bangkok device read submitted_at shifted by
 * their offset — and a time they typed meaning Bangkok was stored shifted.
 * Both halves are pinned to Asia/Bangkok here instead.
 * See REACT_REWRITE_PLAN.md §8.
 */
export function isoToBangkokInput(iso: string | null | undefined): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BANGKOK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ""

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`
}

/**
 * The inverse: a "YYYY-MM-DDTHH:mm" the admin typed, read as Bangkok wall-clock
 * time, back to an ISO instant.
 *
 * Bangkok is UTC+07:00 with no daylight saving and has been since 1940, so a
 * fixed offset is correct and avoids needing a timezone database in the
 * browser. If that ever changes this is the one place to fix.
 */
export function bangkokInputToIso(value: string): string | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  const [, y, mo, d, h, mi] = match
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:00+07:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Read-only rendering of a stored value. */
export function displayValue(column: RosterColumn, value: unknown): string {
  if (value === null || value === undefined || value === "") return ""
  if (isTimestampType(column.data_type)) {
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) return String(value)
    return new Intl.DateTimeFormat("th-TH", {
      timeZone: BANGKOK_TZ,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date)
  }
  return String(value)
}

/** Turn the collected form strings into the JSON body the API expects. */
export function toRequestBody(
  columns: readonly RosterColumn[],
  values: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const column of columns) {
    if (column.is_pk) continue
    const raw = values[column.column_name]
    if (raw === undefined) continue
    if (raw === "") {
      out[column.column_name] = null
      continue
    }
    if (isNumericType(column.data_type)) {
      const n = Number(raw)
      out[column.column_name] = Number.isNaN(n) ? null : n
      continue
    }
    if (isTimestampType(column.data_type)) {
      out[column.column_name] = bangkokInputToIso(raw)
      continue
    }
    out[column.column_name] = raw
  }
  return out
}

/**
 * Thai prefixes attach directly to the given name with no space, e.g.
 * "นพ.สมชาย ใจดี".
 */
export function rosterFullName(row: Record<string, unknown>): string {
  const head = `${row.prefix ?? ""}${row.firstname ?? ""}`.trim()
  return `${head} ${row.lastname ?? ""}`.trim().replace(/\s+/g, " ")
}

/**
 * Sort key WITHOUT the prefix. Sorting on the full name would group everyone by
 * นพ./พญ. first — a Thai collator has no way to know those are titles rather
 * than part of the name — scattering an otherwise-alphabetical roster into two
 * title-shaped halves.
 */
export function rosterSortName(row: Record<string, unknown>): string {
  return `${row.firstname ?? ""} ${row.lastname ?? ""}`.trim().replace(/\s+/g, " ")
}
