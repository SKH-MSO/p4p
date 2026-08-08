import { NextResponse } from "next/server"
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config"
import { setSessionCookie } from "@/lib/gate/session"

export const runtime = "nodejs"

/**
 * The client posts the tokens from its (working) client-side verifyOtp; we
 * validate the access token against Supabase, then stash both in an HttpOnly
 * cookie. The browser never persists a session itself — LINE's in-app webview
 * is unreliable at it, which is the reason this endpoint exists at all.
 */
export async function POST(request: Request) {
  let body: { access_token?: string; refresh_token?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 })
  }

  const { access_token: accessToken, refresh_token: refreshToken } = body
  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: "missing tokens" }, { status: 400 })
  }

  try {
    const check = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!check.ok) throw new Error(`user check failed: ${check.status}`)
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  setSessionCookie(response.cookies, accessToken, refreshToken)
  return response
}
