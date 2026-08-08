"use client"

import { useState } from "react"
import { DEPARTMENTS } from "@/lib/departments"
import { displayValue, inputTypeFor, isoToBangkokInput, rosterFullName } from "@/lib/admin/fields"
import type { RosterColumn } from "@/lib/admin/roster"
import { Spinner } from "@/components/ui"

type Row = Record<string, unknown>

/**
 * One roster row.
 *
 * Collapsed by default (name + department badge only) — a ~200-row roster is
 * unwieldy with every field visible. Tapping the header expands to a read-only
 * field list with edit/delete; edit mode is only reachable from there.
 */
export default function RowCard({
  columns,
  row,
  onSave,
  onDelete,
  onError,
  onCancel,
  initialMode = "view",
  alwaysOpen = false,
  saveLabel = "บันทึก",
}: {
  columns: readonly RosterColumn[]
  row: Row
  onSave: (values: Record<string, string>) => Promise<void>
  onDelete?: () => Promise<void>
  onError: (message: string) => void
  onCancel?: () => void
  initialMode?: "view" | "edit"
  alwaysOpen?: boolean
  saveLabel?: string
}) {
  const [open, setOpen] = useState(alwaysOpen)
  const [mode, setMode] = useState<"view" | "edit">(initialMode)
  const [busy, setBusy] = useState(false)
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(columns, row))

  function initialValues(cols: readonly RosterColumn[], source: Row): Record<string, string> {
    const out: Record<string, string> = {}
    for (const column of cols) {
      const raw = source[column.column_name]
      out[column.column_name] =
        inputTypeFor(column) === "datetime-local"
          ? isoToBangkokInput(raw as string | null)
          : raw === null || raw === undefined
            ? ""
            : String(raw)
    }
    // Almost every row is "นายแพทย์" — autofill it when blank so the admin is
    // not retyping the same value on every add. Still an ordinary editable
    // value, not a fixed default.
    if (out.position === "") out.position = "นายแพทย์"
    return out
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const name = rosterFullName(row) || "(ไม่มีชื่อ)"
  const department = row.department ? String(row.department) : ""

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white">
      {!alwaysOpen ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-3 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-secondary)]">
            {name}
          </span>
          {department ? (
            <span className="shrink-0 rounded-full bg-[var(--color-tertiary)] px-2 py-0.5 text-[0.7rem] text-[var(--color-secondary)]">
              {department}
            </span>
          ) : null}
          <svg
            viewBox="0 0 24 24"
            aria-hidden
            className={`h-4 w-4 shrink-0 stroke-current text-[var(--color-muted)] transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      ) : null}

      {open ? (
        <div className="border-t border-[var(--color-line)] px-3 py-3">
          {columns.map((column) =>
            mode === "view" ? (
              <div key={column.column_name} className="flex gap-2 border-b border-[var(--color-line)]/60 py-1.5 last:border-0">
                <div className="w-[38%] shrink-0 text-[0.7rem] text-[var(--color-muted)]">
                  {column.column_name}
                </div>
                <div className="min-w-0 flex-1 text-sm break-words">
                  {displayValue(column, row[column.column_name]) || (
                    <span className="text-[var(--color-faint)]">—</span>
                  )}
                </div>
              </div>
            ) : (
              <label key={column.column_name} className="mb-2 block">
                <span className="mb-1 block text-[0.7rem] text-[var(--color-muted)]">
                  {column.column_name}
                </span>
                {column.column_name === "department" ? (
                  <select
                    value={values.department ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, department: e.target.value }))}
                    className="w-full rounded-[var(--radius-card)] border border-[var(--color-line)] px-2 py-2 text-sm"
                  >
                    <option value="">—</option>
                    {/* Keep an unrecognised legacy value selectable so saving
                        without touching this field cannot silently rewrite it. */}
                    {(values.department && !DEPARTMENTS.includes(values.department as never)
                      ? [values.department, ...DEPARTMENTS]
                      : DEPARTMENTS
                    ).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={inputTypeFor(column)}
                    step={inputTypeFor(column) === "number" ? "any" : undefined}
                    value={values[column.column_name] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [column.column_name]: e.target.value }))
                    }
                    className="w-full rounded-[var(--radius-card)] border border-[var(--color-line)] px-2 py-2 text-sm"
                  />
                )}
              </label>
            ),
          )}

          <div className="mt-3 flex justify-end gap-2">
            {mode === "view" ? (
              <>
                {onDelete ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(onDelete)}
                    className="rounded-[var(--radius-card)] border border-[var(--color-danger)] px-3 py-1.5 text-xs font-semibold text-[var(--color-danger)] disabled:opacity-50"
                  >
                    ลบ
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setValues(initialValues(columns, row))
                    setMode("edit")
                  }}
                  className="rounded-[var(--radius-card)] bg-[var(--color-secondary)] px-3 py-1.5 text-xs font-semibold text-white"
                >
                  แก้ไข
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (onCancel) onCancel()
                    else setMode("view")
                  }}
                  className="rounded-[var(--radius-card)] border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-[var(--color-secondary)] disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await onSave(values)
                      setMode("view")
                    })
                  }
                  className="rounded-[var(--radius-card)] bg-[var(--color-secondary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busy ? <Spinner /> : saveLabel}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
