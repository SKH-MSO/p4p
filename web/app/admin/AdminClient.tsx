"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import DesktopBlock, { useDeviceGate } from "@/components/DesktopBlock"
import { Notice, Spinner } from "@/components/ui"
import { departmentLabel, sortDepartments } from "@/lib/departments"
import { rosterFullName, rosterSortName, toRequestBody } from "@/lib/admin/fields"
import type { RosterColumn } from "@/lib/admin/roster"
import { monthKey, toBE } from "@/lib/months"
import RowCard from "./RowCard"

type Row = Record<string, unknown>

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init })
  if (response.status === 401) throw new Error("unauthorized")
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(body.error ?? `request failed: ${response.status}`)
  return body as T
}

/** Current Thai-calendar YYYY_MM — the month to preselect. */
function currentRosterTable(): string {
  const now = new Date()
  return monthKey(toBE(now.getFullYear()), now.getMonth() + 1)
}

export default function AdminClient() {
  // /admin/ is the one page that legitimately runs outside LINE.
  const device = useDeviceGate(false)

  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [tables, setTables] = useState<string[]>([])
  const [table, setTable] = useState("")
  const [columns, setColumns] = useState<RosterColumn[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [department, setDepartment] = useState("")
  const [adding, setAdding] = useState(false)
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  const flash = useCallback((kind: "ok" | "error", text: string) => {
    setStatus({ kind, text })
    setTimeout(() => setStatus(null), 3500)
  }, [])

  const pkColumn = useMemo(() => columns.find((c) => c.is_pk)?.column_name ?? "index", [columns])
  const editable = useMemo(() => columns.filter((c) => !c.is_pk), [columns])

  const loadTable = useCallback(async (target: string) => {
    setLoading(true)
    try {
      const [{ columns: cols }, { rows: fetched }] = await Promise.all([
        api<{ columns: RosterColumn[] }>(`/admin/api/tables/${encodeURIComponent(target)}/columns`),
        api<{ rows: Row[] }>(`/admin/api/tables/${encodeURIComponent(target)}/rows`),
      ])
      setColumns(cols)
      setRows(fetched)
      setQuery("")
      setDepartment("")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (device !== "allowed") return
    let cancelled = false
    ;(async () => {
      try {
        const { tables: list } = await api<{ tables: string[] }>("/admin/api/tables")
        if (cancelled) return
        setAuthorized(true)
        // The API returns ascending YYYY_MM; show newest month first.
        const sorted = [...list].sort().reverse()
        setTables(sorted)
        const preferred = currentRosterTable()
        const initial = sorted.includes(preferred) ? preferred : (sorted[0] ?? "")
        setTable(initial)
        if (initial) await loadTable(initial)
        else setLoading(false)
      } catch (err) {
        if (cancelled) return
        if (err instanceof Error && err.message === "unauthorized") setAuthorized(false)
        else flash("error", `โหลดไม่สำเร็จ: ${(err as Error).message}`)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [device, loadTable, flash])

  const presentDepartments = useMemo(
    () => sortDepartments([...new Set(rows.map((r) => String(r.department ?? "")).filter(Boolean))]),
    [rows],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((row) => {
        if (department && row.department !== department) return false
        if (!q) return true
        return `${rosterFullName(row)} ${row.department ?? ""}`.toLowerCase().includes(q)
      })
      .sort((a, b) => rosterSortName(a).localeCompare(rosterSortName(b), "th"))
  }, [rows, query, department])

  async function handleSave(row: Row, values: Record<string, string>) {
    const body = toRequestBody(columns, values)
    const id = String(row[pkColumn])
    const { row: updated } = await api<{ row: Row | null }>(
      `/admin/api/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(id)}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    )
    setRows((prev) => prev.map((r) => (r === row ? { ...r, ...(updated ?? body) } : r)))
    flash("ok", "บันทึกแล้ว")
  }

  async function handleDelete(row: Row) {
    if (!confirm(`ยืนยันการลบ ${rosterFullName(row)}?`)) return
    const id = String(row[pkColumn])
    await api(`/admin/api/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
    setRows((prev) => prev.filter((r) => r !== row))
    flash("ok", "ลบแล้ว")
  }

  async function handleAdd(values: Record<string, string>) {
    const body = toRequestBody(columns, values)
    const { row } = await api<{ row: Row | null }>(
      `/admin/api/tables/${encodeURIComponent(table)}/rows`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    )
    if (row) setRows((prev) => [...prev, row])
    setAdding(false)
    flash("ok", "เพิ่มแถวแล้ว")
  }

  if (device !== "allowed") return <DesktopBlock state={device} />

  if (authorized === false) {
    return (
      <main className="mx-auto max-w-[520px] px-5 py-16 text-center">
        <h1 className="font-[family-name:var(--font-manrope)] text-lg font-bold text-[var(--color-secondary)]">
          ต้องเข้าสู่ระบบ
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-muted)]">
          กรุณาส่งข้อความ <b className="text-[var(--color-secondary)]">admin</b> ไปยัง LINE
          บอท แล้วเปิดลิงก์ที่ได้รับ
        </p>
      </main>
    )
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[var(--color-line)] bg-[var(--color-neutral)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[640px] items-center justify-between gap-3 px-4 py-3">
          <div className="font-[family-name:var(--font-manrope)] text-base font-bold text-[var(--color-secondary)]">
            ผู้ดูแลระบบ
          </div>
          <button
            type="button"
            onClick={async () => {
              await fetch("/admin/logout", { method: "POST", credentials: "same-origin" }).catch(
                () => {},
              )
              location.reload()
            }}
            className="rounded-[var(--radius-card)] border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-[var(--color-secondary)]"
          >
            ออกจากระบบ
          </button>
        </div>

        <div className="mx-auto flex max-w-[640px] flex-col gap-2 px-4 pb-3">
          <select
            value={table}
            onChange={async (e) => {
              setTable(e.target.value)
              try {
                await loadTable(e.target.value)
              } catch (err) {
                flash("error", `โหลดข้อมูลไม่สำเร็จ: ${(err as Error).message}`)
              }
            }}
            className="w-full rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
          >
            {tables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาชื่อ..."
              autoComplete="off"
              className="min-w-0 flex-1 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
            />
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="max-w-[45%] rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white px-2 py-2 text-sm"
            >
              <option value="">ทุกกลุ่มงาน</option>
              {presentDepartments.map((d) => (
                <option key={d} value={d}>
                  {departmentLabel(d)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[640px] px-4 py-4">
        {status ? (
          <div className="mb-3">
            <Notice kind={status.kind}>{status.text}</Notice>
          </div>
        ) : null}

        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-[var(--color-ink-muted)]">
            {visible.length} จาก {rows.length} แถว
          </span>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            disabled={!columns.length}
            className="rounded-[var(--radius-card)] bg-[var(--color-secondary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {adding ? "ยกเลิก" : "+ เพิ่มแถว"}
          </button>
        </div>

        {adding ? (
          <div className="mb-3">
            <RowCard
              columns={editable}
              row={{}}
              initialMode="edit"
              alwaysOpen
              saveLabel="เพิ่ม"
              onSave={handleAdd}
              onCancel={() => setAdding(false)}
              onError={(m) => flash("error", `เพิ่มแถวไม่สำเร็จ: ${m}`)}
            />
          </div>
        ) : null}

        {loading ? (
          <div className="py-10 text-center">
            <Spinner dark />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--color-ink-muted)]">ไม่พบข้อมูล</p>
        ) : (
          <div className="space-y-2">
            {visible.map((row) => (
              <RowCard
                key={String(row[pkColumn])}
                columns={editable}
                row={row}
                onSave={(values) => handleSave(row, values)}
                onDelete={() => handleDelete(row)}
                onError={(m) => flash("error", `บันทึกไม่สำเร็จ: ${m}`)}
              />
            ))}
          </div>
        )}
      </main>
    </>
  )
}
