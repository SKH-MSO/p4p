/**
 * The single-round-trip gate check, and the decision that comes out of it.
 *
 * Transcribed from main.js (getLineBindGateStatus + the branch tree inside
 * servePage). The decision logic is separated from the HTTP call so every
 * branch can be unit-tested without a network.
 */
import { BIND_ATTEMPT_LIMIT, SUPABASE_ANON_KEY, SUPABASE_URL } from "../config"

export interface GateStatus {
  is_blocked: boolean
  is_bound: boolean
  attempts: number
  session_verified: boolean
  session_revoked: boolean
  enforce_eligible: boolean
}

/**
 * Ask Supabase about the caller: denylisted? LINE userId bound? how many failed
 * bind attempts? did THIS session prove its LINE identity?
 *
 * Called with the USER'S access token, not the anon key. An earlier version
 * used the anon key and passed the email as a parameter, which made the RPC an
 * unauthenticated "is this address a registered physician?" oracle — and meant
 * it could not be locked down, because revoking anon would 403, get swallowed,
 * and silently disable the whole gate including the denylist.
 * get_line_bind_gate_status_self() takes no argument and reads the email from
 * the caller's own JWT, so there is nothing left to enumerate. (apikey must
 * still be the publishable key — Supabase requires that header — but
 * Authorization is what selects the `authenticated` role.)
 *
 * Returns null on any error. What that MEANS is the caller's decision, and
 * depends on LINE_BIND_ENFORCE — see gateDecision().
 */
export async function fetchGateStatus(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GateStatus | null> {
  try {
    const response = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/rpc/get_line_bind_gate_status_self`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(8000),
      },
    )
    if (!response.ok) {
      console.error(`[gate] get_line_bind_gate_status_self failed: ${response.status}`)
      return null
    }
    const rows = (await response.json()) as GateStatus[] | null
    return rows?.[0] ?? null
  } catch (err) {
    console.error("[gate] get_line_bind_gate_status_self failed:", err)
    return null
  }
}

export type GateAction =
  | { type: "serve" }
  | { type: "blocked" }
  | { type: "expired" }
  | { type: "gate_unavailable" }
  | { type: "bind_required" }

export interface GateInput {
  status: GateStatus | null
  enforce: boolean
  /** How many consecutive bind_required redirects this browser has already had. */
  loopCount: number
  loopMax: number
}

/**
 * Decide what to do with a gated page request. Pure — no I/O, no framework.
 *
 * Order matters and matches main.js exactly.
 */
export function gateDecision({ status, enforce, loopCount, loopMax }: GateInput): GateAction {
  if (!status) {
    // Could not confirm the denylist OR the session's LINE proof.
    if (enforce) return { type: "gate_unavailable" }
    // Detect-only keeps the historical fail-open. This is a real gap while it
    // lasts: a broken gate RPC stops blocked_emails being enforced at all. It
    // is kept because a transient Supabase hiccup must not lock out a whole
    // hospital.
    return { type: "serve" }
  }

  if (status.is_blocked) return { type: "blocked" }

  // Signed out, or revoked by an admin: Supabase DELETES the auth.sessions row,
  // so a missing row means this access token outlived its session. Applies in
  // both modes — it is a correctness fix, not part of the second factor.
  if (status.session_revoked) return { type: "expired" }

  // `enforce_eligible` is true only for emails that have proved their LINE
  // identity through this flow at least once. Without that condition, switching
  // enforcement on would bounce every physician at once if the LIFF app turned
  // out to be missing the `openid` scope — ~200 people locked out of a hospital
  // tool by one env var. Users who have never proved keep the old rules until
  // they do, so the factor phases in.
  const wantsBindRedirect =
    enforce && status.enforce_eligible
      ? !status.session_verified
      : !status.is_bound && status.attempts < BIND_ATTEMPT_LIMIT

  if (!wantsBindRedirect) return { type: "serve" }

  // Hard backstop, independent of the DB-backed attempts count above. This
  // redirect must never fire more than loopMax times in a row for one browser,
  // full stop, regardless of whether Supabase, LINE, or the client's own retry
  // accounting are behaving correctly. An unbound physician got stuck in
  // exactly this loop in 2026-08 with no way out.
  if (loopCount >= loopMax) {
    console.warn("[bind-loop] backstop tripped — serving unbound rather than redirecting again")
    return { type: "serve" }
  }

  return { type: "bind_required" }
}
