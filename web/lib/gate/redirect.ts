/**
 * Building redirect responses that keep their trailing "#".
 *
 * Two Next behaviours make this necessary, both found by inspecting the emitted
 * header rather than by reading docs:
 *
 *   1. NextResponse.redirect() serialises through Next's own NextURL wrapper,
 *      which DROPS an empty fragment. "/status/#" goes out as "/status/".
 *   2. Constructing a NextResponse with a relative Location throws
 *      ERR_INVALID_URL — Next parses the header as an absolute URL.
 *
 * A plain Response is subject to neither: middleware may return one, and its
 * headers are passed through verbatim. The cost is serialising Set-Cookie by
 * hand, which is a handful of lines and fully testable.
 *
 * Why the "#" matters at all: see lib/gate/targets.ts.
 */

export interface CookieSpec {
  name: string
  value: string
  maxAge: number
}

/** Serialise one cookie with the attributes every P4P cookie shares. */
export function serializeCookie({ name, value, maxAge }: CookieSpec): string {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

/**
 * A 302 whose Location is emitted exactly as given — relative, fragment and
 * all. 302 rather than 307 to match the Express behaviour these replace.
 */
export function redirectResponse(
  location: string,
  extraHeaders: Record<string, string> = {},
  cookies: CookieSpec[] = [],
): Response {
  const headers = new Headers(extraHeaders)
  headers.set("Location", location)
  for (const cookie of cookies) {
    headers.append("Set-Cookie", serializeCookie(cookie))
  }
  return new Response(null, { status: 302, headers })
}
