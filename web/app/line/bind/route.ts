import { NextResponse } from "next/server"
import { SUPABASE_ANON_KEY, SUPABASE_URL, serverEnv } from "@/lib/config"
import { jwtPayload } from "@/lib/gate/jwt"
import { verifyLineIdToken } from "@/lib/line/verify"

export const runtime = "nodejs"

/**
 * Bind (or re-prove) the caller's LINE identity — the second factor.
 *
 * Both identities are established SERVER-SIDE here, and neither is taken on
 * trust from the request body:
 *   who they are in P4P   -> Supabase validates the access token
 *   who they are on LINE  -> LINE validates the ID token, and its `sub` claim
 *                            is the userId we store/compare
 * The DB function is service_role-only, so a browser cannot reach it directly
 * and cannot assert a LINE userId of its own choosing the way the old
 * bind_line_user_id(p_line_user_id) allowed.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") ?? ""
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

  let idToken = ""
  try {
    idToken = ((await request.json()) as { id_token?: string }).id_token ?? ""
  } catch {
    /* handled by the missing-token check below */
  }
  if (!accessToken || !idToken) {
    return NextResponse.json({ error: "missing token" }, { status: 400 })
  }

  // 1. Validate the session against Supabase rather than reading the JWT body —
  //    this endpoint decides who a LINE account gets attached to, so the email
  //    must come from an authority, not from an unverified claim.
  let email: string | undefined
  try {
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!userResponse.ok) throw new Error(String(userResponse.status))
    email = ((await userResponse.json()) as { email?: string }).email
  } catch {
    return NextResponse.json({ error: "invalid session" }, { status: 401 })
  }
  if (!email) return NextResponse.json({ error: "no email on session" }, { status: 401 })

  // 2. Validate the LINE ID token with LINE.
  const line = await verifyLineIdToken(idToken)
  if (!line) return NextResponse.json({ error: "line verification failed" }, { status: 401 })

  // Without a session_id there is nothing to attach the proof to, so
  // get_line_bind_gate_status_self would keep reporting session_verified=false
  // and — with enforcement on — bounce the user straight back here forever.
  // Fail loudly instead: an infinite redirect inside LINE's webview is close to
  // undebuggable from the physician's side.
  const sessionId = jwtPayload(accessToken).session_id
  if (!sessionId) {
    console.error("[line-bind] access token has no session_id claim — cannot record proof")
    return NextResponse.json({ error: "no session_id on token" }, { status: 500 })
  }

  const serviceKey = serverEnv.supabaseServiceRoleKey()
  if (!serviceKey) {
    console.error("[line-bind] SUPABASE_SERVICE_ROLE_KEY is not set")
    return NextResponse.json({ error: "bind failed" }, { status: 500 })
  }

  // 3. Record it. session_id ties the proof to THIS session; it is stable
  //    across refreshes, so a physician proves once per session rather than
  //    once per page load.
  try {
    const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bind_line_user_id_verified`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_email: email,
        p_line_user_id: line.sub,
        p_line_display_name: line.name,
        p_session_id: sessionId,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!rpc.ok) throw new Error(`bind RPC ${rpc.status}`)

    const data = (await rpc.json()) as { status?: string } | null
    const status = data?.status ?? "error"
    console.log(`[line-bind] ${email} -> ${status}`)

    if (status === "mismatch") return NextResponse.json({ status }, { status: 403 })
    if (status === "bound" || status === "match") return NextResponse.json({ status })
    return NextResponse.json({ status }, { status: 500 })
  } catch (err) {
    console.error("[line-bind] bind RPC failed:", err)
    return NextResponse.json({ error: "bind failed" }, { status: 500 })
  }
}
