import { NextResponse } from "next/server"
import { clearSessionCookie } from "@/lib/gate/session"

export const runtime = "nodejs"

/**
 * Clears our cookie only. It does NOT call Supabase signOut — matching the
 * Express behaviour. Real revocation happens through the gate's
 * `session_revoked` check, which notices when Supabase has deleted the
 * auth.sessions row.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true })
  clearSessionCookie(response.cookies)
  return response
}
