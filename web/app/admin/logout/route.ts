import { NextResponse } from "next/server"
import { ADMIN_COOKIE, COOKIE_BASE } from "@/lib/config"

export const runtime = "nodejs"

export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(ADMIN_COOKIE, "", { ...COOKIE_BASE, maxAge: 0 })
  return response
}
