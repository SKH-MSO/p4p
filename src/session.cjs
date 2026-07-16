// ── Server-side session cookie + JWT helpers ────────────────────────────────
// Split out of main.js so these can be unit-tested without booting Express
// (see test/session.test.cjs). Everything here is a pure function over
// request/response-like objects — no Supabase calls, no network, no globals.
//
// The session cookie holds BOTH tokens as JSON: {at: access, rt: refresh}. We
// cache the access token so we only hit Supabase's refresh endpoint when it's
// near expiry — refreshing on every page load rotated the refresh token each
// time, which Supabase can flag as reuse/theft and revoke the whole session.

const RT_COOKIE = "p4p_rt"
const COOKIE_BASE = "HttpOnly; Secure; SameSite=Lax; Path=/"

function parseCookies(req) {
  const out = {}
  const raw = req.headers.cookie
  if (!raw) return out
  for (const part of raw.split(";")) {
    const i = part.indexOf("=")
    if (i === -1) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function setSessionCookie(res, at, rt) {
  const val = encodeURIComponent(JSON.stringify({ at: at, rt: rt }))
  res.append("Set-Cookie", RT_COOKIE + "=" + val + "; " + COOKIE_BASE + "; Max-Age=34560000")
}

function clearSessionCookie(res) {
  res.append("Set-Cookie", RT_COOKIE + "=; " + COOKIE_BASE + "; Max-Age=0")
}

function readSessionCookie(req) {
  const raw = parseCookies(req)[RT_COOKIE]
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    // Valid JSON but no usable refresh token inside — treat as no session
    // rather than falling through to using the raw JSON string itself as a
    // (bogus) refresh token.
    return o && o.rt ? { at: o.at || null, rt: o.rt } : null
  } catch {
    // Legacy cookie held a bare refresh token (pre-JSON format).
    return { at: null, rt: raw }
  }
}

// Read a JWT's payload without verifying it (the token itself was already
// validated by Supabase at /auth/session or the refresh call — this is just
// for reading claims out of a token we already trust).
function jwtPayload(token) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"))
  } catch {
    return {}
  }
}

function jwtExp(token) {
  const exp = jwtPayload(token).exp
  return typeof exp === "number" ? exp : 0
}

function jwtEmail(token) {
  return jwtPayload(token).email || null
}

module.exports = {
  RT_COOKIE,
  COOKIE_BASE,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  jwtPayload,
  jwtExp,
  jwtEmail,
}
