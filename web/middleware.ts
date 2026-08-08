import { NextResponse, type NextRequest } from "next/server"
import {
  BIND_LOOP_COOKIE,
  BIND_LOOP_MAX,
  lineBindEnforce,
} from "./lib/config"
import { resolveAccessToken } from "./lib/gate/session"
import { fetchGateStatus, gateDecision } from "./lib/gate/status"
import { canonicalPath, verifyBounce } from "./lib/gate/targets"
import { redirectResponse, type CookieSpec } from "./lib/gate/redirect"

/**
 * The gate, transcribed from main.js's servePage(), plus the CSP nonce.
 *
 * Runs before every page request. Three jobs:
 *   1. URL canonicalisation, which is subtler than it looks (see below)
 *   2. session + LINE-bind gating for /status, /list, /ranking
 *   3. a per-request CSP nonce, so Next's inline scripts do not force
 *      'unsafe-inline' into a policy that deliberately does not have it
 *
 * /admin/* is NOT gated here — it has its own auth (lib/admin), and bouncing an
 * admin to /verify/ would be wrong. The matcher excludes it.
 */

const GATED_PAGES = ["status", "list", "ranking"] as const

/** Header the page's Server Component reads to get the access token. */
export const TOKEN_HEADER = "x-p4p-access-token"
export const NONCE_HEADER = "x-nonce"

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    // 'self' covers our bundles; the nonce covers Next's inline bootstrap and
    // RSC payload scripts. No 'unsafe-inline' — the fonts are self-hosted by
    // next/font and both CDN script origins are gone (Supabase and LIFF are
    // bundled from npm), so this is strictly tighter than the Express version.
    // 'strict-dynamic' is deliberately omitted: it would disable the 'self'
    // allowance in browsers that honour it, and Next's chunk loading relies on
    // plain same-origin <script src>.
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.line.me https://access.line.me",
    // frame-ancestors intentionally omitted so the pages still load inside
    // LINE's LIFF webview.
  ].join("; ")
}

function securityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp)
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  return response
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  const nonce = btoa(crypto.randomUUID())
  const csp = buildCsp(nonce)

  /** Headers forwarded to the route being rendered. */
  const forwarded = new Headers(request.headers)
  forwarded.set(NONCE_HEADER, nonce)

  const passThrough = (rewriteTo?: string) => {
    const response = rewriteTo
      ? NextResponse.rewrite(new URL(rewriteTo + search, request.url), {
          request: { headers: forwarded },
        })
      : NextResponse.next({ request: { headers: forwarded } })
    return securityHeaders(response, csp)
  }

  // A plain Response, NOT NextResponse.redirect() — see lib/gate/redirect.ts.
  //
  // Two constraints, discovered by inspecting the emitted header:
  //   - NextResponse.redirect() serialises through NextURL, which DROPS the
  //     trailing empty fragment these targets depend on.
  //   - Next validates the Location of ANY response middleware returns and
  //     rejects a relative one with ERR_INVALID_URL.
  // So: absolutise here with the standard URL class, which (unlike NextURL)
  // keeps the "#", and hand the result to a plain Response.
  const redirect = (to: string, cookies: CookieSpec[] = []) =>
    redirectResponse(
      new URL(to, request.url).href,
      {
        "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
      cookies,
    )

  const sessionCookie = (at: string, rt: string): CookieSpec => ({
    name: "p4p_rt",
    value: JSON.stringify({ at, rt }),
    maxAge: 34_560_000,
  })
  const clearedSession: CookieSpec = { name: "p4p_rt", value: "", maxAge: 0 }
  const loopCookie = (n: number): CookieSpec => ({
    name: BIND_LOOP_COOKIE,
    value: String(n),
    maxAge: 900,
  })

  // ── /verify and /verify/ ──────────────────────────────────────────────
  // BOTH render, with NO redirect between them.
  //
  // LIFF completes a login by navigating to the app's registered Endpoint URL
  // with "#access_token=…" appended. A redirect whose Location carries its own
  // fragment replaces LIFF's; liff.init() then finds no login state, restarts
  // login, lands back here, and loops forever inside the webview. That is the
  // 2026-08 outage. A rewrite is internal — no Location header, no navigation,
  // no fragment involved — so it cannot reproduce it.
  //
  // The token is injected whenever a VALID SESSION EXISTS, not only when the
  // URL still says ?reason=bind_required: LIFF's login round-trip does not
  // preserve our query string, so keying off the parameter dropped physicians
  // onto the email form for an account they were already signed in to.
  if (pathname === "/verify" || pathname === "/verify/") {
    const resolved = await resolveAccessToken(request.cookies)
    if (resolved.at) forwarded.set(TOKEN_HEADER, resolved.at)

    const response = passThrough("/verify")
    if (resolved.rotated) {
      setSessionOn(response, resolved.rotated.at, resolved.rotated.rt)
    } else if (resolved.clear) {
      clearSessionOn(response)
    }
    console.log(
      `[verify] reason=${request.nextUrl.searchParams.get("reason") ?? "-"} ` +
        `session=${resolved.at ? "yes" : "no"}`,
    )
    return response
  }

  // ── Gated pages ───────────────────────────────────────────────────────
  const gated = GATED_PAGES.find((p) => pathname === `/${p}` || pathname === `/${p}/`)
  if (!gated) return passThrough()

  // Canonicalise to the trailing-slash form first. LIFF opens "/status" with no
  // slash. Unlike /verify, these DO want the redirect, and they want an
  // explicit trailing "#": LINE's iOS webview carries an old fragment forward
  // onto the new URL when our Location has none of its own, and a stale token
  // from a DIFFERENT LIFF app then rides along and fails liff.init() with
  // "Invalid LIFF ID". An empty fragment of our own stops that.
  if (pathname === `/${gated}`) {
    return redirect(canonicalPath(gated, search))
  }

  const returnTo = pathname + search
  const resolved = await resolveAccessToken(request.cookies)

  if (!resolved.at) {
    return redirect(
      verifyBounce(resolved.reason ?? "no_session", returnTo),
      resolved.clear ? [clearedSession] : [],
    )
  }

  const status = await fetchGateStatus(resolved.at)
  const loopCount = readLoopCount(request)
  const action = gateDecision({
    status,
    enforce: lineBindEnforce(),
    loopCount,
    loopMax: BIND_LOOP_MAX,
  })

  const rotated: CookieSpec[] = resolved.rotated
    ? [sessionCookie(resolved.rotated.at, resolved.rotated.rt)]
    : []

  switch (action.type) {
    case "blocked":
      return redirect(verifyBounce("blocked"), [clearedSession])
    case "expired":
      return redirect(verifyBounce("expired"), [clearedSession])
    case "gate_unavailable":
      return redirect(verifyBounce("gate_unavailable", returnTo), rotated)
    case "bind_required":
      return redirect(verifyBounce("bind_required", returnTo), [
        ...rotated,
        loopCookie(loopCount + 1),
      ])
    case "serve":
    default: {
      forwarded.set(TOKEN_HEADER, resolved.at)
      const response = passThrough(`/${gated}`)
      if (resolved.rotated) setSessionOn(response, resolved.rotated.at, resolved.rotated.rt)
      clearLoopCount(response)
      return response
    }
  }
}

// ── Cookie helpers, applied to a response ──────────────────────────────────
function setSessionOn(response: NextResponse, at: string, rt: string): void {
  response.cookies.set("p4p_rt", JSON.stringify({ at, rt }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 34_560_000,
  })
}

function clearSessionOn(response: NextResponse): void {
  response.cookies.set("p4p_rt", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
}

function readLoopCount(request: NextRequest): number {
  const n = parseInt(request.cookies.get(BIND_LOOP_COOKIE)?.value ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function clearLoopCount(response: NextResponse): void {
  response.cookies.set(BIND_LOOP_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
}

export const config = {
  /**
   * Pages only.
   *
   * Excluded, and each for a reason:
   *   api|auth|line|telegram|admin — route handlers with their own auth. In
   *     particular /admin/* must never reach the physician gate, or an admin
   *     would be bounced to /verify/.
   *   _next/*, favicon, assets — static output; running the gate on every chunk
   *     would add a Supabase round trip per asset.
   */
  matcher: [
    "/((?!api|auth|line|telegram|admin|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)",
  ],
}
