/**
 * The physician session cookie, and turning it into a usable access token.
 *
 * Transcribed from main.js (readSessionCookie / setSessionCookie /
 * resolveAccessToken). The behaviour is deliberately unchanged — see the
 * comments below for the parts that look odd but are load-bearing.
 */
import { SESSION_COOKIE, SUPABASE_ANON_KEY, SUPABASE_URL } from "../config"
import { isExpiring } from "./jwt"

export interface SessionTokens {
  /** Cached access token. May be absent or stale; the caller refreshes. */
  at: string | null
  rt: string
}

/** Minimal cookie surface, so this works with both NextRequest and plain maps. */
export interface CookieReader {
  get(name: string): { value: string } | undefined
}

export interface CookieWriter {
  set(name: string, value: string, options: Record<string, unknown>): void
}

/**
 * The cookie holds BOTH tokens as JSON: {at, rt}.
 *
 * The access token is cached so we only hit Supabase's refresh endpoint when it
 * is near expiry. Refreshing on every page load rotated the refresh token each
 * time, which Supabase can flag as reuse/theft and revoke the whole session.
 */
export function readSessionCookie(cookies: CookieReader): SessionTokens | null {
  const raw = cookies.get(SESSION_COOKIE)?.value
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { at?: string; rt?: string }
    // Valid JSON but no usable refresh token inside — treat as no session
    // rather than falling through to using the raw JSON string itself as a
    // (bogus) refresh token.
    return parsed?.rt ? { at: parsed.at ?? null, rt: parsed.rt } : null
  } catch {
    // Legacy cookie held a bare refresh token (pre-JSON format).
    return { at: null, rt: raw }
  }
}

const SESSION_MAX_AGE = 34_560_000 // 400 days, as in main.js

export function setSessionCookie(cookies: CookieWriter, at: string, rt: string): void {
  cookies.set(SESSION_COOKIE, JSON.stringify({ at, rt }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  })
}

export function clearSessionCookie(cookies: CookieWriter): void {
  cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
}

export type ResolveFailure = "no_session" | "expired"

export interface ResolvedToken {
  at: string | null
  reason: ResolveFailure | null
  /** Set when the cookie should be rewritten with rotated tokens. */
  rotated?: { at: string; rt: string }
  /** Set when the session is dead and the cookie should be cleared. */
  clear?: boolean
}

/**
 * Resolve a usable access token from the session cookie: reuse the cached one
 * while it is fresh, otherwise refresh once.
 *
 * Returns what the caller should DO rather than mutating a response, so this
 * stays testable and usable from both middleware and route handlers.
 */
export async function resolveAccessToken(
  cookies: CookieReader,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedToken> {
  const session = readSessionCookie(cookies)
  if (!session) return { at: null, reason: "no_session" }

  if (!isExpiring(session.at)) {
    return { at: session.at, reason: null }
  }

  try {
    const response = await fetchImpl(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.rt }),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error(`refresh failed: ${response.status}`)
    const data = (await response.json()) as { access_token?: string; refresh_token?: string }
    if (!data.access_token) throw new Error("no access_token in refresh response")
    return {
      at: data.access_token,
      reason: null,
      rotated: { at: data.access_token, rt: data.refresh_token ?? session.rt },
    }
  } catch {
    return { at: null, reason: "expired", clear: true }
  }
}
