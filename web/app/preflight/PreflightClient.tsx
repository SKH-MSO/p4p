"use client"

import { useCallback, useEffect, useState } from "react"

type CheckStatus = "pending" | "pass" | "fail" | "warn" | "skip"

interface Check {
  readonly id: string
  readonly label: string
  readonly status: CheckStatus
  readonly detail: string
}

const STATUS_STYLES: Record<CheckStatus, { dot: string; text: string }> = {
  pending: { dot: "bg-[var(--color-line)]", text: "text-[var(--color-ink-muted)]" },
  pass: { dot: "bg-[var(--color-success)]", text: "text-[var(--color-ink)]" },
  fail: { dot: "bg-[var(--color-danger)]", text: "text-[var(--color-danger)]" },
  warn: { dot: "bg-[var(--color-primary)]", text: "text-[var(--color-ink)]" },
  skip: { dot: "bg-[var(--color-line)]", text: "text-[var(--color-ink-muted)]" },
}

/**
 * Flatten anything throwable into one readable line. Ported from
 * describeError() in verify/app.js — the physician's device has no console, so
 * whatever we cannot render here is simply invisible.
 */
function describeError(err: unknown): string {
  if (err === null || err === undefined) return "unknown error"
  if (typeof err !== "object") return String(err)

  const record = err as Record<string, unknown>
  const parts: string[] = []
  for (const key of ["message", "details", "hint", "code"]) {
    if (record[key] !== undefined) parts.push(`${key}: ${String(record[key])}`)
  }
  for (const key of Object.keys(record)) {
    if (["message", "details", "hint", "code"].includes(key)) continue
    try {
      const value = record[key]
      parts.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    } catch {
      /* unstringifiable — skip */
    }
  }
  return parts.length > 0 ? parts.join(" | ") : String(err)
}

export default function PreflightClient() {
  const [checks, setChecks] = useState<Check[]>([])
  const [running, setRunning] = useState(false)

  const run = useCallback(async () => {
    setRunning(true)
    const results: Check[] = []
    const push = (c: Check) => {
      results.push(c)
      setChecks([...results])
    }

    // ── 1. Environment ────────────────────────────────────────────────────
    const ua = navigator.userAgent
    const inLine = /Line\//i.test(ua)
    push({
      id: "webview",
      label: "Opened inside LINE",
      status: inLine ? "pass" : "warn",
      detail: inLine
        ? "LINE webview detected"
        : "Not the LINE webview. LIFF checks below will not be meaningful.",
    })
    push({ id: "ua", label: "User agent", status: "pass", detail: ua })
    push({ id: "url", label: "Page URL", status: "pass", detail: window.location.href })

    // The login fragment LINE appends. If it is missing on a first open, the
    // redirect/rewrite handling is eating it — the 2026-08 failure mode.
    const hash = window.location.hash
    push({
      id: "fragment",
      label: "URL fragment",
      status: hash ? "pass" : "warn",
      detail: hash
        ? `present (${hash.length} chars)`
        : "empty — expected on a first LIFF open, fine on a reload",
    })

    // ── 2. The npm LIFF SDK ───────────────────────────────────────────────
    const liffId =
      new URLSearchParams(window.location.search).get("liffId") ??
      process.env.NEXT_PUBLIC_LIFF_ID_PREFLIGHT ??
      ""

    if (!liffId) {
      push({
        id: "liff",
        label: "LIFF checks",
        status: "skip",
        detail:
          "No LIFF id. Add ?liffId=<staging-liff-id> to the URL, or set " +
          "NEXT_PUBLIC_LIFF_ID_PREFLIGHT. See REACT_REWRITE_PLAN.md §5.",
      })
      setRunning(false)
      return
    }
    push({ id: "liffid", label: "LIFF id under test", status: "pass", detail: liffId })

    let liff: typeof import("@line/liff").default
    try {
      liff = (await import("@line/liff")).default
      push({
        id: "sdk",
        label: "npm @line/liff loads",
        status: "pass",
        detail: `bundled from node_modules, version ${liff.getVersion?.() ?? "unknown"}`,
      })
    } catch (err) {
      push({
        id: "sdk",
        label: "npm @line/liff loads",
        status: "fail",
        detail:
          `${describeError(err)} — fall back to the CDN <script> tag and keep ` +
          "static.line-scdn.net in the CSP (plan §3).",
      })
      setRunning(false)
      return
    }

    try {
      await liff.init({ liffId })
      push({ id: "init", label: "liff.init()", status: "pass", detail: "initialised" })
    } catch (err) {
      push({
        id: "init",
        label: "liff.init()",
        status: "fail",
        detail: `${describeError(err)} | liffId: ${liffId} | url: ${window.location.href}`,
      })
      setRunning(false)
      return
    }

    push({
      id: "context",
      label: "LIFF context",
      status: "pass",
      detail: `os=${liff.getOS() ?? "?"} lang=${liff.getLanguage()} inClient=${liff.isInClient()} version=${liff.getLineVersion() ?? "?"}`,
    })

    const loggedIn = liff.isLoggedIn()
    push({
      id: "login",
      label: "liff.isLoggedIn()",
      status: loggedIn ? "pass" : "fail",
      detail: String(loggedIn),
    })
    if (!loggedIn) {
      setRunning(false)
      return
    }

    // ── 3. The check that actually matters ────────────────────────────────
    // getIDToken() returns null unless the LIFF app has the `openid` scope.
    // getProfile() only needs `profile`, so the scope can look fine while the
    // bind flow is silently impossible. This is the 2026-08 root cause.
    const idToken = liff.getIDToken()
    push({
      id: "idtoken",
      label: "liff.getIDToken()",
      status: idToken ? "pass" : "fail",
      detail: idToken
        ? `token present (${idToken.length} chars) — the \`openid\` scope is enabled`
        : "null — the LIFF app is missing the `openid` scope. Enable it in the " +
          "LINE Developers console for this LIFF id, or the bind flow cannot work.",
    })

    setRunning(false)
  }, [])

  useEffect(() => {
    void run()
  }, [run])

  const failed = checks.filter((c) => c.status === "fail").length

  return (
    <main className="mx-auto max-w-[520px] px-5 py-8">
      <h1 className="font-[family-name:var(--font-manrope)] text-xl font-bold text-[var(--color-secondary)]">
        P4P preflight
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        Phase 0 scaffold check. Not a user-facing page.
      </p>

      <ul className="mt-6 space-y-3">
        {checks.map((check) => {
          const style = STATUS_STYLES[check.status]
          return (
            <li
              key={check.id}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-3"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
                <span className="text-sm font-semibold text-[var(--color-secondary)]">
                  {check.label}
                </span>
              </div>
              <p
                className={`mt-1 font-mono text-xs leading-relaxed break-words ${style.text}`}
              >
                {check.detail}
              </p>
            </li>
          )
        })}
      </ul>

      {!running && (
        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--color-ink-muted)]">
            {failed > 0 ? `${failed} check(s) failed` : "No failures"}
          </span>
          <button
            type="button"
            onClick={() => void run()}
            className="rounded-[var(--radius-card)] bg-[var(--color-secondary)] px-4 py-2 text-sm font-semibold text-white"
          >
            Run again
          </button>
        </div>
      )}
    </main>
  )
}
