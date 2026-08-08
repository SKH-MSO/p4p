"use client"

import { useEffect, useMemo, useState } from "react"
import DesktopBlock, { useDeviceGate } from "@/components/DesktopBlock"
import { BackToTop, Skeleton, StateBox } from "@/components/ui"
import { departmentLabel, fullName, sortDepartments } from "@/lib/departments"
import { monthColorHex } from "@/lib/colors"
import { parseMonthKey, thaiLabelFromKey } from "@/lib/months"
import { isMissingTable, supabaseWithToken, type RosterRow } from "@/lib/supabase-browser"

interface Entry {
  name: string
  department: string
  sent: boolean
}

/**
 * Five interdependent `style.display` assignments in the legacy page collapse
 * into this one value. Which section is on screen was previously implicit in
 * the combination of several booleans, and getting it wrong showed two lists at
 * once.
 */
type View = { mode: "sections" } | { mode: "filtered"; entries: Entry[] }

type SearchBy = "name" | "department"

export default function StatusClient({
  accessToken,
  monthKey,
}: {
  accessToken: string
  monthKey: string | null
}) {
  const device = useDeviceGate()
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [searchBy, setSearchBy] = useState<SearchBy>("name")
  const [department, setDepartment] = useState("")

  useEffect(() => {
    if (device !== "allowed" || !monthKey) return
    let cancelled = false

    ;(async () => {
      const db = supabaseWithToken(accessToken)
      const { data, error: queryError } = await db
        .from(monthKey)
        .select("firstname, lastname, department, submitted_at")

      if (cancelled) return
      if (queryError) {
        setError(isMissingTable(queryError) ? "ยังไม่มีข้อมูลของเดือนนี้" : "เกิดข้อผิดพลาด")
        return
      }
      setEntries(
        (data as RosterRow[]).map((row) => ({
          name: fullName(row.firstname, row.lastname),
          department: row.department ?? "",
          sent: row.submitted_at != null,
        })),
      )
    })()

    return () => {
      cancelled = true
    }
  }, [device, accessToken, monthKey])

  const departments = useMemo(
    () => sortDepartments([...new Set((entries ?? []).map((e) => e.department).filter(Boolean))]),
    [entries],
  )

  const view: View = useMemo(() => {
    if (!entries) return { mode: "sections" }

    if (department) {
      return { mode: "filtered", entries: entries.filter((e) => e.department === department) }
    }
    if (query === "") return { mode: "sections" }
    // A query of only spaces means "show everything, grouped" — a documented
    // affordance in the legacy UI, explained by the hint under the search box.
    if (/^ +$/.test(query)) return { mode: "filtered", entries }

    const needle = query.trim().toLowerCase()
    const field = searchBy === "name" ? "name" : "department"
    return {
      mode: "filtered",
      entries: entries.filter((e) => e[field].toLowerCase().includes(needle)),
    }
  }, [entries, query, searchBy, department])

  const pending = useMemo(
    () => (entries ?? []).filter((e) => !e.sent).sort(byName),
    [entries],
  )
  const sent = useMemo(() => (entries ?? []).filter((e) => e.sent).sort(byName), [entries])

  if (device !== "allowed") return <DesktopBlock state={device} />

  const monthLabel = monthKey ? thaiLabelFromKey(monthKey) : null
  const accent = monthKey ? monthColorHex(parseMonthKey(monthKey)!.month) : undefined

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[var(--color-line)] bg-[var(--color-neutral)]/95 backdrop-blur">
        <div className="mx-auto max-w-[640px] px-4 py-3">
          <div className="flex items-center gap-2">
            {monthLabel ? (
              <span
                className="rounded-[var(--radius-card)] px-2.5 py-1 font-[family-name:var(--font-manrope)] text-sm font-bold text-[var(--color-ink)]"
                style={{ background: accent }}
              >
                {monthLabel}
              </span>
            ) : (
              <span className="font-[family-name:var(--font-manrope)] text-sm font-bold text-[var(--color-secondary)]">
                {monthKey === null ? "ไม่พบพารามิเตอร์" : <Skeleton className="h-5 w-28" />}
              </span>
            )}
            {entries ? (
              <span className="text-xs text-[var(--color-ink-muted)]">
                (ส่ง {sent.length} จาก {entries.length} ราย)
              </span>
            ) : monthKey ? (
              <Skeleton className="h-4 w-24" />
            ) : null}
          </div>

          {monthKey ? (
            <div className="mt-3 space-y-2">
              <input
                type="search"
                value={query}
                disabled={!entries}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setDepartment("")
                }}
                placeholder="พิมพ์เพื่อค้นหา.."
                autoComplete="off"
                className="w-full rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white px-3 py-2 text-sm disabled:opacity-60"
              />
              <p className="text-[0.7rem] text-[var(--color-muted)]">
                พิมพ์เว้นวรรคเพื่อดูรายชื่อทั้งหมดเรียงตามกลุ่มงาน
              </p>

              <div className="flex items-center gap-4 text-xs">
                {(["name", "department"] as const).map((mode) => (
                  <label key={mode} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="search_by"
                      checked={searchBy === mode}
                      disabled={!entries}
                      onChange={() => {
                        setSearchBy(mode)
                        setQuery("")
                        setDepartment("")
                      }}
                    />
                    <span className={entries ? "text-[var(--color-secondary)]" : "text-[var(--color-muted)]"}>
                      {mode === "name" ? "ชื่อแพทย์" : "ชื่อกลุ่มงาน"}
                    </span>
                  </label>
                ))}
              </div>

              {searchBy === "department" ? (
                <select
                  value={department}
                  disabled={!entries}
                  onChange={(e) => {
                    setDepartment(e.target.value)
                    setQuery("")
                  }}
                  className="w-full rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white px-3 py-2 text-sm disabled:opacity-60"
                >
                  <option value="">ทุกกลุ่มงาน</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {departmentLabel(d)}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-[640px] px-4 py-4">
        {monthKey === null ? (
          <StateBox kind="error" title="ไม่พบพารามิเตอร์" sub="กรุณาเปิดจากเมนูเลือกเดือนใน LINE" />
        ) : error ? (
          <StateBox kind="error" title={error} />
        ) : !entries ? (
          <StateBox kind="loading" title="กำลังโหลด..." />
        ) : view.mode === "filtered" ? (
          <GroupedList entries={view.entries} />
        ) : (
          <div className="space-y-3">
            <Section title="รายชื่อผู้ที่ยังไม่ได้ส่ง" entries={pending} defaultOpen />
            <Section title="รายชื่อผู้ที่ส่งแล้ว" entries={sent} />
          </div>
        )}
      </main>

      <BackToTop threshold={20} />
    </>
  )
}

const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name, "th")

function Section({
  title,
  entries,
  defaultOpen = false,
}: {
  title: string
  entries: Entry[]
  defaultOpen?: boolean
}) {
  return (
    <details
      open={defaultOpen}
      className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white"
    >
      <summary className="cursor-pointer bg-[var(--color-secondary)] px-3 py-2.5 font-[family-name:var(--font-manrope)] text-sm font-semibold text-white">
        {title} ({entries.length})
      </summary>
      <ul>
        {entries.map((entry, i) => (
          <Row key={`${entry.name}-${i}`} entry={entry} showDepartment />
        ))}
      </ul>
    </details>
  )
}

function GroupedList({ entries }: { entries: Entry[] }) {
  const groups = useMemo(() => {
    const departments = sortDepartments([...new Set(entries.map((e) => e.department))])
    return departments
      .map((dep) => ({
        dep,
        rows: entries.filter((e) => e.department === dep).sort(byName),
      }))
      .filter((g) => g.rows.length > 0)
  }, [entries])

  if (entries.length === 0) {
    return <StateBox kind="empty" title="ไม่พบข้อมูล" sub="ลองเปลี่ยนคำค้นหา" />
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white">
      {groups.map(({ dep, rows }) => (
        <section key={dep}>
          <h2 className="bg-[var(--color-tertiary)] px-3 py-2 text-xs font-semibold text-[var(--color-secondary)]">
            {dep ? departmentLabel(dep) : "ไม่ระบุกลุ่มงาน"}
          </h2>
          <ul>
            {rows.map((entry, i) => (
              <Row key={`${entry.name}-${i}`} entry={entry} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Row({ entry, showDepartment = false }: { entry: Entry; showDepartment?: boolean }) {
  return (
    <li className="flex items-center gap-2 border-b border-[var(--color-line)]/60 px-3 py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${entry.sent ? "" : "text-[var(--color-ink-muted)]"}`}>
          {entry.name || "—"}
        </p>
        {showDepartment && entry.department ? (
          <p className="truncate text-[0.7rem] text-[var(--color-muted)]">{entry.department}</p>
        ) : null}
      </div>
      <StatusIcon sent={entry.sent} />
    </li>
  )
}

function StatusIcon({ sent }: { sent: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={sent ? "ส่งแล้ว" : "ยังไม่ได้ส่ง"}
      className={`h-4 w-4 shrink-0 ${sent ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {sent ? <path d="M20 6 9 17l-5-5" /> : <path d="M18 6 6 18M6 6l12 12" />}
    </svg>
  )
}
