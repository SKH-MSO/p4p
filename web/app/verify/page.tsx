/**
 * PLACEHOLDER — /verify/ is Phase 5 and has not been built yet.
 *
 * It exists now because the middleware gate redirects here, so without it every
 * unauthenticated request would 404 and the redirect chain could not be tested
 * end to end. Both /verify and /verify/ render this via a middleware rewrite.
 *
 * Replaced in Phase 5 by the real OTP + access-request + LINE-bind flow.
 */
export const dynamic = "force-dynamic"

export default function VerifyPlaceholder() {
  return (
    <main className="mx-auto max-w-[520px] px-5 py-16 text-center">
      <h1 className="font-[family-name:var(--font-manrope)] text-lg font-bold text-[var(--color-secondary)]">
        ยืนยันตัวตน
      </h1>
      <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
        Phase 5 — not implemented yet. The Express app at <code>/verify/</code> is still the
        live implementation.
      </p>
    </main>
  )
}
