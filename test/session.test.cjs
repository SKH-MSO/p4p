// Unit tests for the server-side session cookie + JWT helpers.
// Run with: npm test  (node --test)
const { test } = require("node:test")
const assert = require("node:assert/strict")

const {
  RT_COOKIE,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  jwtPayload,
  jwtExp,
  jwtEmail,
} = require("../src/session.cjs")

// A minimal Express-ish response: collects Set-Cookie header values.
function fakeRes() {
  const cookies = []
  return {
    cookies,
    append(name, value) {
      assert.equal(name, "Set-Cookie")
      cookies.push(value)
    },
  }
}
// Build an unsigned JWT-shaped token with the given payload (base64url middle
// segment is all jwtPayload actually reads).
function makeToken(payload) {
  const b64 = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  return "header." + b64 + ".sig"
}

// ── parseCookies ────────────────────────────────────────────────────────────
test("parseCookies: no cookie header returns empty object", () => {
  assert.deepEqual(parseCookies({ headers: {} }), {})
})

test("parseCookies: splits multiple cookies and trims whitespace", () => {
  const out = parseCookies({ headers: { cookie: "a=1; b=2 ;  c=3" } })
  assert.deepEqual(out, { a: "1", b: "2", c: "3" })
})

test("parseCookies: URL-decodes values", () => {
  const out = parseCookies({ headers: { cookie: "x=%7B%22rt%22%3A%221%22%7D" } })
  assert.equal(out.x, '{"rt":"1"}')
})

test("parseCookies: ignores a malformed segment with no '='", () => {
  const out = parseCookies({ headers: { cookie: "novalue; k=v" } })
  assert.deepEqual(out, { k: "v" })
})

// ── set / read round-trip ───────────────────────────────────────────────────
test("setSessionCookie then readSessionCookie round-trips both tokens", () => {
  const res = fakeRes()
  setSessionCookie(res, "access-abc", "refresh-xyz")
  const req = { headers: { cookie: res.cookies[0].split(";")[0] } }
  assert.deepEqual(readSessionCookie(req), { at: "access-abc", rt: "refresh-xyz" })
})

test("setSessionCookie emits HttpOnly + Secure + long Max-Age", () => {
  const res = fakeRes()
  setSessionCookie(res, "a", "b")
  const raw = res.cookies[0]
  assert.match(raw, new RegExp("^" + RT_COOKIE + "="))
  assert.match(raw, /HttpOnly/)
  assert.match(raw, /Secure/)
  assert.match(raw, /Max-Age=34560000/)
})

test("clearSessionCookie emits an expiring empty cookie", () => {
  const res = fakeRes()
  clearSessionCookie(res)
  assert.match(res.cookies[0], new RegExp("^" + RT_COOKIE + "=;"))
  assert.match(res.cookies[0], /Max-Age=0/)
})

// ── readSessionCookie edge cases ────────────────────────────────────────────
test("readSessionCookie: no cookie returns null", () => {
  assert.equal(readSessionCookie({ headers: {} }), null)
})

test("readSessionCookie: valid JSON without rt is treated as no session", () => {
  const val = encodeURIComponent(JSON.stringify({ at: "only-access" }))
  const req = { headers: { cookie: RT_COOKIE + "=" + val } }
  assert.equal(readSessionCookie(req), null)
})

test("readSessionCookie: JSON with rt but no at yields at:null", () => {
  const val = encodeURIComponent(JSON.stringify({ rt: "refresh-only" }))
  const req = { headers: { cookie: RT_COOKIE + "=" + val } }
  assert.deepEqual(readSessionCookie(req), { at: null, rt: "refresh-only" })
})

test("readSessionCookie: legacy bare (non-JSON) value is used as refresh token", () => {
  const req = { headers: { cookie: RT_COOKIE + "=legacy-refresh-token" } }
  assert.deepEqual(readSessionCookie(req), { at: null, rt: "legacy-refresh-token" })
})

// ── JWT helpers ─────────────────────────────────────────────────────────────
test("jwtPayload: decodes base64url payload", () => {
  const token = makeToken({ email: "a@b.co", exp: 123 })
  assert.deepEqual(jwtPayload(token), { email: "a@b.co", exp: 123 })
})

test("jwtPayload: malformed token returns empty object (never throws)", () => {
  assert.deepEqual(jwtPayload("not-a-jwt"), {})
  assert.deepEqual(jwtPayload(""), {})
})

test("jwtExp: numeric exp returned, missing/non-numeric exp -> 0", () => {
  assert.equal(jwtExp(makeToken({ exp: 1700000000 })), 1700000000)
  assert.equal(jwtExp(makeToken({ email: "a@b.co" })), 0)
  assert.equal(jwtExp(makeToken({ exp: "soon" })), 0)
})

test("jwtEmail: returns email claim or null", () => {
  assert.equal(jwtEmail(makeToken({ email: "doc@example.com" })), "doc@example.com")
  assert.equal(jwtEmail(makeToken({ sub: "123" })), null)
})
