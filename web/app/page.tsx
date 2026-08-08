/**
 * Placeholder root.
 *
 * The real app has no page at "/" — physicians always arrive at /verify/,
 * /status/, /list/ or /ranking/ from a LINE rich menu or Flex message. This
 * exists so the scaffold has something to render, and is replaced (or removed)
 * once those four routes land in Phases 2–5.
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-[520px] px-5 py-8">
      <h1 className="font-[family-name:var(--font-manrope)] text-xl font-bold text-[var(--color-secondary)]">
        SAKHONMSO P4P
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Next.js rewrite scaffold. See REACT_REWRITE_PLAN.md.
      </p>
      <a
        href="/preflight"
        className="mt-4 inline-block text-sm font-semibold text-[var(--color-primary)] underline"
      >
        /preflight
      </a>
    </main>
  )
}
