import { NextResponse } from "next/server"
import { COOKIE_BASE } from "@/lib/config"
import { adminSessionCookie, verifyAdminToken } from "@/lib/admin/tokens"

export const runtime = "nodejs"

/**
 * One-time login link from the LINE bot. Invalid or expired -> bounce to the
 * dashboard itself, which shows the "message the bot" instructions.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? ""
  if (!verifyAdminToken("login", token)) {
    return NextResponse.redirect(new URL("/admin/?error=bad_token", request.url))
  }

  const response = NextResponse.redirect(new URL("/admin/", request.url))
  const cookie = adminSessionCookie()
  response.cookies.set(cookie.name, cookie.value, { ...COOKIE_BASE, maxAge: cookie.maxAge })
  return response
}
