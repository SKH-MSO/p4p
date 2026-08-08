import { describe, expect, it, vi } from "vitest"
import { jwtExp, jwtPayload, isExpiring } from "../gate/jwt"
import { readSessionCookie, resolveAccessToken } from "../gate/session"
import { gateDecision, type GateStatus } from "../gate/status"
import { BIND_LOOP_MAX } from "../config"

/** Build an unsigned JWT with the given payload — only the body is ever read. */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url")
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`
}

function cookies(map: Record<string, string>) {
  return { get: (name: string) => (name in map ? { value: map[name]! } : undefined) }
}

describe("jwtPayload", () => {
  it("reads claims", () => {
    const token = fakeJwt({ exp: 123, session_id: "sess-1", email: "a@b.co" })
    expect(jwtPayload(token)).toMatchObject({ exp: 123, session_id: "sess-1" })
    expect(jwtExp(token)).toBe(123)
  })

  it("survives non-ASCII claims", () => {
    // A Thai display name in a claim would be mangled by a naive atob.
    expect(jwtPayload(fakeJwt({ name: "สมชาย" })).name).toBe("สมชาย")
  })

  it("returns an empty payload rather than throwing on garbage", () => {
    for (const bad of ["", "not.a.jwt", "onlyonepart", "a.!!!.c"]) {
      expect(jwtPayload(bad)).toEqual({})
      expect(jwtExp(bad)).toBe(0)
    }
  })
})

describe("isExpiring", () => {
  const future = Math.floor(Date.now() / 1000) + 3600
  const past = Math.floor(Date.now() / 1000) - 10

  it("is false for a comfortably fresh token", () => {
    expect(isExpiring(fakeJwt({ exp: future }))).toBe(false)
  })

  it("is true for a missing, expired, or nearly-expired token", () => {
    expect(isExpiring(null)).toBe(true)
    expect(isExpiring(fakeJwt({ exp: past }))).toBe(true)
    // Within the 60s skew.
    expect(isExpiring(fakeJwt({ exp: Math.floor(Date.now() / 1000) + 30 }))).toBe(true)
  })
})

describe("readSessionCookie", () => {
  it("reads the JSON form", () => {
    const raw = JSON.stringify({ at: "access", rt: "refresh" })
    expect(readSessionCookie(cookies({ p4p_rt: raw }))).toEqual({ at: "access", rt: "refresh" })
  })

  it("accepts a legacy bare refresh token", () => {
    expect(readSessionCookie(cookies({ p4p_rt: "legacy-token" }))).toEqual({
      at: null,
      rt: "legacy-token",
    })
  })

  it("treats valid JSON with no rt as no session", () => {
    // The bug this guards: falling through to using the JSON string itself as a
    // (bogus) refresh token.
    expect(readSessionCookie(cookies({ p4p_rt: JSON.stringify({ at: "x" }) }))).toBeNull()
  })

  it("returns null when the cookie is absent", () => {
    expect(readSessionCookie(cookies({}))).toBeNull()
  })
})

describe("resolveAccessToken", () => {
  const fresh = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
  const stale = fakeJwt({ exp: Math.floor(Date.now() / 1000) - 10 })

  it("reports no_session with no cookie", async () => {
    const result = await resolveAccessToken(cookies({}))
    expect(result).toEqual({ at: null, reason: "no_session" })
  })

  it("reuses a fresh cached token without hitting the network", async () => {
    const fetchImpl = vi.fn()
    const raw = JSON.stringify({ at: fresh, rt: "refresh" })
    const result = await resolveAccessToken(cookies({ p4p_rt: raw }), fetchImpl as never)

    expect(result.at).toBe(fresh)
    expect(result.rotated).toBeUndefined()
    // Refreshing on every page load rotated the refresh token each time, which
    // Supabase can flag as reuse and revoke the whole session. This assertion
    // is the guard against that regression.
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("refreshes a stale token and reports the rotation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "new-at", refresh_token: "new-rt" }),
    })
    const raw = JSON.stringify({ at: stale, rt: "old-rt" })
    const result = await resolveAccessToken(cookies({ p4p_rt: raw }), fetchImpl as never)

    expect(result.at).toBe("new-at")
    expect(result.rotated).toEqual({ at: "new-at", rt: "new-rt" })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("keeps the old refresh token when the response omits a new one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "new-at" }),
    })
    const raw = JSON.stringify({ at: stale, rt: "old-rt" })
    const result = await resolveAccessToken(cookies({ p4p_rt: raw }), fetchImpl as never)
    expect(result.rotated).toEqual({ at: "new-at", rt: "old-rt" })
  })

  it("reports expired and asks for the cookie to be cleared when refresh fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400 })
    const raw = JSON.stringify({ at: stale, rt: "old-rt" })
    const result = await resolveAccessToken(cookies({ p4p_rt: raw }), fetchImpl as never)

    expect(result).toMatchObject({ at: null, reason: "expired", clear: true })
  })

  it("treats a network throw the same as a failed refresh", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"))
    const raw = JSON.stringify({ at: stale, rt: "old-rt" })
    const result = await resolveAccessToken(cookies({ p4p_rt: raw }), fetchImpl as never)
    expect(result).toMatchObject({ at: null, reason: "expired", clear: true })
  })
})

// ── The branch tree that decides whether someone gets in ────────────────────
describe("gateDecision", () => {
  const base: GateStatus = {
    is_blocked: false,
    is_bound: true,
    attempts: 0,
    session_verified: true,
    session_revoked: false,
    enforce_eligible: true,
  }
  const decide = (status: GateStatus | null, enforce = false, loopCount = 0) =>
    gateDecision({ status, enforce, loopCount, loopMax: BIND_LOOP_MAX })

  it("serves a bound, verified, unblocked session", () => {
    expect(decide(base).type).toBe("serve")
  })

  it("bounces a denylisted email even with a valid session", () => {
    expect(decide({ ...base, is_blocked: true }).type).toBe("blocked")
  })

  it("checks the denylist before anything else", () => {
    // Blocked wins over revoked and unbound alike.
    expect(decide({ ...base, is_blocked: true, session_revoked: true, is_bound: false }).type).toBe(
      "blocked",
    )
  })

  it("treats a revoked session as expired in both modes", () => {
    expect(decide({ ...base, session_revoked: true }).type).toBe("expired")
    expect(decide({ ...base, session_revoked: true }, true).type).toBe("expired")
  })

  describe("detect-only mode (LINE_BIND_ENFORCE unset)", () => {
    it("fails OPEN when the gate RPC is unreachable", () => {
      // A transient Supabase hiccup must not lock out a whole hospital.
      expect(decide(null).type).toBe("serve")
    })

    it("redirects an unbound session under the attempt limit", () => {
      expect(decide({ ...base, is_bound: false, attempts: 0 }).type).toBe("bind_required")
      expect(decide({ ...base, is_bound: false, attempts: 2 }).type).toBe("bind_required")
    })

    it("lets an unbound session through once the attempt limit is reached", () => {
      expect(decide({ ...base, is_bound: false, attempts: 3 }).type).toBe("serve")
    })

    it("ignores session_verified", () => {
      expect(decide({ ...base, session_verified: false }).type).toBe("serve")
    })
  })

  describe("enforce mode", () => {
    it("refuses to serve when the gate RPC is unreachable", () => {
      expect(decide(null, true).type).toBe("gate_unavailable")
    })

    it("requires this session to have proved its LINE identity", () => {
      expect(decide({ ...base, session_verified: false }, true).type).toBe("bind_required")
      expect(decide({ ...base, session_verified: true }, true).type).toBe("serve")
    })

    it("ignores the attempts fail-open for eligible users", () => {
      // The whole point of enforcement: 3 failures no longer buys entry.
      expect(
        decide({ ...base, session_verified: false, attempts: 99 }, true).type,
      ).toBe("bind_required")
    })

    it("keeps the old rules for users who have never proved", () => {
      // enforce_eligible=false phases the factor in, so switching the env var on
      // cannot bounce every physician at once if the LIFF app is missing the
      // openid scope.
      const neverProved = { ...base, enforce_eligible: false, session_verified: false }
      expect(decide(neverProved, true).type).toBe("serve") // bound, so no redirect
      expect(decide({ ...neverProved, is_bound: false, attempts: 3 }, true).type).toBe("serve")
      expect(decide({ ...neverProved, is_bound: false, attempts: 0 }, true).type).toBe(
        "bind_required",
      )
    })
  })

  describe("redirect-loop backstop", () => {
    const unbound = { ...base, is_bound: false, attempts: 0 }

    it("still redirects below the cap", () => {
      expect(decide(unbound, false, BIND_LOOP_MAX - 1).type).toBe("bind_required")
    })

    it("serves instead of redirecting once the cap is hit", () => {
      // Pure server state, deliberately independent of Supabase, LINE, and the
      // client's own retry accounting. This is what stops the 2026-08 loop.
      expect(decide(unbound, false, BIND_LOOP_MAX).type).toBe("serve")
      expect(decide(unbound, false, BIND_LOOP_MAX + 5).type).toBe("serve")
    })

    it("applies in enforce mode too", () => {
      expect(
        decide({ ...base, session_verified: false }, true, BIND_LOOP_MAX).type,
      ).toBe("serve")
    })
  })
})
