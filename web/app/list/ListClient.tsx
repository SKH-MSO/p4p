"use client"

import { useEffect, useMemo, useState } from "react"
import DesktopBlock, { useDeviceGate } from "@/components/DesktopBlock"
import { BackToTop, StateBox } from "@/components/ui"
import { monthColorHex } from "@/lib/colors"
import { fullName } from "@/lib/departments"
import { parseMonthKey, thaiLabelFromKey } from "@/lib/months"
import { pageRange, pageRangeMobile, type PageToken } from "@/lib/pagination"
import { isMissingTable, supabaseWithToken, type RosterRow } from "@/lib/supabase-browser"

const PAGE_SIZE = 25
const DASH = "—"

interface Person {
  name: string
  department: string
}

type SortColumn = "name" | "department"

export default function ListClient({
  accessToken,
  months,
}: {
  accessToken: string
  months: string[]
}) {
  const device = useDeviceGate()
  const [month, setMonth] = useState("")
  const [people, setPeople] = useState<Person[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<{ column: SortColumn; dir: "asc" | "desc" } | null>(null)
  const [page, setPage] = useState(1)
  const [showAll, setShowAll] = useState(false)
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth <= 481)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  useEffect(() => {
    if (device !== "allowed" || !month) return
    let cancelled = false
    setPeople(null)
    setError(null)

    ;(async () => {
      const db = supabaseWithToken(accessToken)
      const { data, error: queryError } = await db
        .from(month)
        .select("firstname, lastname, department")

      // Guard against an out-of-order response from a previous month; the
      // legacy page used a monotonically increasing token for the same reason.
      if (cancelled) return
      if (queryError) {
        setError(isMissingTable(queryError) ? "ยังไม่มีข้อมูลของเดือนนี้" : queryError.message)
        return
      }
      setPeople(
        (data as RosterRow[])
          .map((row) => ({
            name: fullName(row.firstname, row.lastname) || DASH,
            department: row.department || DASH,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "th")),
      )
      setQuery("")
      setSort(null)
      setPage(1)
      setShowAll(false)
    })()

    return () => {
      cancelled = true
    }
  }, [device, accessToken, month])

  const filtered = useMemo(() => {
    if (!people) return []
    const q = query.trim().toLowerCase()
    const base = q
      ? people.filter((p) => `${p.name} ${p.department}`.toLowerCase().includes(q))
      : people
    if (!sort) return base

    const { column, dir } = sort
    return [...base].sort((a, b) => {
      const av = a[column]
      const bv = b[column]
      return dir === "asc" ? av.localeCompare(bv, "th") : bv.localeCompare(av, "th")
    })
  }, [people, query, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const start = showAll ? 0 : (currentPage - 1) * PAGE_SIZE
  const rows = showAll ? filtered : filtered.slice(start, start + PAGE_SIZE)

  const uniqueDepartments = useMemo(
    () => new Set((people ?? []).map((p) => p.department).filter((d) => d !== DASH)).size,
    [people],
  )

  if (device !== "allowed") return <DesktopBlock state={device} />

  const accent = month ? monthColorHex(parseMonthKey(month)!.month) : "var(--color-line)"

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[var(--color-line)] bg-[var(--color-neutral)]/95 backdrop-blur">
        <div className="mx-auto max-w-[640px] px-4 py-3">
          <div className="font-[family-name:var(--font-manrope)] text-base font-bold text-[var(--color-secondary)]">
            SAKHONMSO P4P
          </div>
          <div className="text-xs text-[var(--color-ink-muted)]">ข้อมูลแพทย์รายเดือน</div>

          <div className="mt-3 flex gap-2">
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="min-w-0 flex-1 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
            >
              <option value="" disabled>
                เลือกเดือน...
              </option>
              {months.map((key) => (
                <option key={key} value={key}>
                  {thaiLabelFromKey(key)}
                </option>
              ))}
            </select>
            <input
              type="search"
              value={query}
              disabled={!people}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              placeholder="ค้นหาชื่อหรือแผนก..."
              className="min-w-0 flex-1 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white px-3 py-2 text-sm disabled:opacity-60"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[640px] px-4 py-4">
        {people ? (
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Stat value={people.length.toLocaleString()} label="แพทย์ทั้งหมด" />
            <Stat value={String(uniqueDepartments)} label="แผนก" />
            {query ? <Stat value={String(filtered.length)} label="ผลการค้นหา" /> : null}
          </div>
        ) : null}

        <div
          className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white"
          style={{ borderTop: `3px solid ${accent}` }}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-line)] px-3 py-2">
            <span className="font-[family-name:var(--font-manrope)] text-sm font-semibold text-[var(--color-secondary)]">
              รายชื่อแพทย์
            </span>
            <span className="text-xs text-[var(--color-ink-muted)]">
              <strong>{people ? filtered.length : DASH}</strong> รายการ
            </span>
          </div>

          {!month ? (
            <StateBox kind="empty" title="เลือกเดือนเพื่อดูข้อมูล" />
          ) : error ? (
            <StateBox kind="error" title="โหลดข้อมูลไม่ได้" sub={error} />
          ) : !people ? (
            <StateBox kind="loading" title="กำลังโหลด..." />
          ) : filtered.length === 0 ? (
            <StateBox kind="empty" title="ไม่พบข้อมูล" sub="ลองเปลี่ยนคำค้นหา" />
          ) : (
            <>
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr style={{ background: accent }}>
                    <th className="w-10 px-2 py-2 text-left font-[family-name:var(--font-manrope)] text-xs text-[var(--color-secondary)]">
                      #
                    </th>
                    <SortHeader
                      label="ชื่อ-นามสกุล"
                      column="name"
                      sort={sort}
                      onSort={setSort}
                      onPage={setPage}
                    />
                    <SortHeader
                      label="แผนก"
                      column="department"
                      sort={sort}
                      onSort={setSort}
                      onPage={setPage}
                    />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((person, i) => (
                    <tr key={`${person.name}-${start + i}`} className="border-b border-[var(--color-line)]/60 last:border-0">
                      <td className="px-2 py-2 text-xs text-[var(--color-faint)]">{start + i + 1}</td>
                      <td className="px-2 py-2 break-words">
                        {person.name === DASH ? <Faint /> : person.name}
                      </td>
                      <td className="px-2 py-2 break-words">
                        {person.department === DASH ? <Faint /> : person.department}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] px-3 py-2">
                <span className="text-xs text-[var(--color-ink-muted)]">
                  <strong>
                    {showAll ? 1 : start + 1}–{showAll ? filtered.length : Math.min(start + PAGE_SIZE, filtered.length)}
                  </strong>{" "}
                  จาก <strong>{filtered.length}</strong>
                </span>

                <div className="flex flex-wrap items-center gap-1">
                  <PagerButton
                    active={showAll}
                    accent={accent}
                    onClick={() => {
                      setShowAll((v) => !v)
                      setPage(1)
                    }}
                  >
                    ทั้งหมด
                  </PagerButton>

                  {!showAll ? (
                    <>
                      <PagerButton disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                        ‹
                      </PagerButton>
                      {(narrow ? pageRangeMobile : pageRange)(currentPage, totalPages).map(
                        (token: PageToken, i) =>
                          token === "…" ? (
                            <span key={`gap-${i}`} className="px-1 text-xs text-[var(--color-muted)]">
                              …
                            </span>
                          ) : (
                            <PagerButton
                              key={token}
                              active={token === currentPage}
                              accent={accent}
                              onClick={() => setPage(token)}
                            >
                              {token}
                            </PagerButton>
                          ),
                      )}
                      <PagerButton
                        disabled={currentPage === totalPages}
                        onClick={() => setPage(currentPage + 1)}
                      >
                        ›
                      </PagerButton>
                    </>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-[var(--color-muted)]">
          องค์กรแพทย์ โรงพยาบาลสมุทรสาคร
        </p>
      </main>

      <BackToTop />
    </>
  )
}

function Faint() {
  return <span className="text-[var(--color-faint)]">{DASH}</span>
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white px-2 py-2 text-center">
      <div className="font-[family-name:var(--font-manrope)] text-base font-bold text-[var(--color-secondary)]">
        {value}
      </div>
      <div className="text-[0.65rem] text-[var(--color-ink-muted)]">{label}</div>
    </div>
  )
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  onPage,
}: {
  label: string
  column: SortColumn
  sort: { column: SortColumn; dir: "asc" | "desc" } | null
  onSort: (s: { column: SortColumn; dir: "asc" | "desc" }) => void
  onPage: (p: number) => void
}) {
  const active = sort?.column === column
  return (
    <th className="px-2 py-2 text-left font-[family-name:var(--font-manrope)] text-xs text-[var(--color-secondary)]">
      <button
        type="button"
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        onClick={() => {
          onSort({ column, dir: active && sort.dir === "asc" ? "desc" : "asc" })
          onPage(1)
        }}
        className="flex items-center gap-1"
      >
        {label}
        <span aria-hidden className="text-[0.6rem]">
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  )
}

function PagerButton({
  children,
  onClick,
  active = false,
  disabled = false,
  accent,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  disabled?: boolean
  accent?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={active && accent ? { background: accent, borderColor: accent } : undefined}
      className={`min-w-8 rounded-[var(--radius-card)] border border-[var(--color-line)] px-2 py-1 text-xs ${
        active ? "font-semibold text-[var(--color-secondary)]" : "text-[var(--color-ink-muted)]"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  )
}
