"use client"

import { useEffect, useState, type ReactNode } from "react"

/**
 * The small shared primitives. Each of these exists three or four times across
 * the legacy pages in slightly different forms; this is the single version.
 */

export function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <span
      role="status"
      aria-label="กำลังโหลด"
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 align-middle ${
        dark
          ? "border-[color-mix(in_srgb,var(--color-secondary)_25%,transparent)] border-t-[var(--color-secondary)]"
          : "border-white/40 border-t-white"
      }`}
    />
  )
}

export type StateKind = "loading" | "empty" | "error"

/** Loading / empty / error, which the list and ranking pages both need. */
export function StateBox({
  kind,
  title,
  sub,
}: {
  kind: StateKind
  title: string
  sub?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {kind === "loading" ? (
        <Spinner dark />
      ) : (
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`h-8 w-8 ${kind === "error" ? "fill-[var(--color-danger)]" : "fill-[var(--color-muted)]"}`}
        >
          {kind === "error" ? (
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          ) : (
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z" />
          )}
        </svg>
      )}
      <div className="font-[family-name:var(--font-manrope)] text-sm font-semibold text-[var(--color-secondary)]">
        {title}
      </div>
      {sub ? <div className="text-xs text-[var(--color-ink-muted)]">{sub}</div> : null}
    </div>
  )
}

/** Grey placeholder used while the month header resolves. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-pulse rounded-[var(--radius-card)] bg-[var(--color-line)] ${className}`}
    />
  )
}

export function BackToTop({ threshold = 200 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > threshold)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    // The legacy pages never removed this listener. Harmless on a page that
    // only ever unloads, but wrong the moment a component unmounts.
    return () => window.removeEventListener("scroll", onScroll)
  }, [threshold])

  return (
    <button
      type="button"
      aria-label="กลับขึ้นด้านบน"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`fixed right-4 bottom-4 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-secondary)] text-white shadow-lg transition-opacity ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
        <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
      </svg>
    </button>
  )
}

/** The page-level banner used for transient success/error notices. */
export function Notice({ kind, children }: { kind: "ok" | "error" | "info"; children: ReactNode }) {
  const styles = {
    ok: "bg-[#eef5ee] text-[var(--color-success)]",
    error: "bg-[#fbeae8] text-[var(--color-danger)]",
    info: "bg-[var(--color-tertiary)] text-[var(--color-secondary)] border border-[var(--color-line)]",
  }[kind]
  return (
    <div role="status" className={`rounded-[var(--radius-card)] px-3 py-2.5 text-sm ${styles}`}>
      {children}
    </div>
  )
}

/** Shared page shell: consistent max width and padding on every page. */
export function AppHeader({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-line)] bg-[var(--color-neutral)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[640px] items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="font-[family-name:var(--font-manrope)] text-base font-bold text-[var(--color-secondary)]">
            {title}
          </div>
          {subtitle ? (
            <div className="truncate text-xs text-[var(--color-ink-muted)]">{subtitle}</div>
          ) : null}
        </div>
        {right}
      </div>
    </header>
  )
}
