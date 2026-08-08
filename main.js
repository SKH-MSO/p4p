const express = require("express")
const process = require("node:process")
const line = require("@line/bot-sdk")
const axios = require("axios")
const app = express()

const port = process.env.PORT || 3000
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET

// For the Telegram approve/reject buttons (scripts/telegram-approve-buttons.sql).
// SUPABASE_SERVICE_ROLE_KEY bypasses RLS — required only here, kept server-side.
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// The LINE **Login** channel that owns the /verify/ LIFF app — NOT the
// Messaging API channel that LINE_CHANNEL_SECRET/LINE_ACCESS_TOKEN belong to.
// Used as `client_id` when asking LINE to verify a LIFF ID token; it is the
// `aud` LINE checks the token against, so a token minted for someone else's
// channel is rejected. Without this, ID-token verification cannot run at all.
const LINE_LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID

// Staged rollout switch for the LINE second factor (scripts/line-bind-verified.sql).
//
//   unset/false — DETECT ONLY. Binding is still verified against LINE and a
//                 mismatch is refused and alerted, but page access keeps the
//                 existing rules, including the "3 failures then let them
//                 through" fail-open. Zero lockout risk.
//   "true"      — ENFORCE. A gated page requires that THIS SESSION proved its
//                 LINE identity, and the fail-opens are switched off (both the
//                 attempts limit and the "gate RPC unreachable" path).
//
// Do NOT enable until /verify/ has been observed completing real binds in
// production, because it depends on the LIFF app having the `openid` scope —
// liff.getIDToken() returns null without it and every bind fails. Check with:
//   select count(*) from public.line_verified_sessions where verified_at > now() - interval '1 day';
const LINE_BIND_ENFORCE = process.env.LINE_BIND_ENFORCE === "true"

const headers = {
  "Content-Type": "application/json",
  "Authorization": "Bearer " + LINE_ACCESS_TOKEN
}
const config = {
  channelSecret: LINE_CHANNEL_SECRET,
}
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: LINE_ACCESS_TOKEN,
})
// Month names, colors, and the 6-month iterator are shared with the rich-menu
// script via src/constants.cjs (local names kept for readability below).
const {
  COLOR_ARRAY: color_array,
  MONTH_NAMES: month_array,
  MONTH_ITERATOR: month_iterator,
} = require("./src/constants.cjs")

// ── Server-side session validation ───────────────────────────────────────
// The LINE (LIFF) in-app browser does not persist a client-side Supabase
// session across navigations, so the browser can't hold the auth token. Instead
// the SERVER validates the session: after the client verifies its OTP it posts
// the tokens here; we keep the refresh token in an HttpOnly cookie and, on every
// gated page request, exchange it for a fresh access token which we inject into
// the page. The browser only ever holds a short-lived access token in memory.
const fs = require("node:fs")
const path = require("node:path")
const SUPABASE_URL = "https://zjeizbrzcltkgtlmkbji.supabase.co"
const SUPABASE_ANON = "sb_publishable_TcCSpznim4fi0Y7E_zuAsg_op19VZQ-"
const RT_COOKIE = "p4p_rt"
const COOKIE_BASE = "HttpOnly; Secure; SameSite=Lax; Path=/"
const PAGE_TOKEN_PLACEHOLDER = "__P4P_ACCESS_TOKEN__"

// Gated pages cached as templates; the server fills the token placeholder per
// request. Files never change at runtime.
const gatedPages = ["status", "list", "ranking"]
const pageTemplates = {}
for (const p of gatedPages) {
  pageTemplates[p] = fs.readFileSync(path.join(__dirname, p, "index.html"), "utf8")
}
// /verify/ also carries the same <meta name="p4p-session"> placeholder, used
// only for the silent LINE-bind bounce (see servePage's "bind_required"
// redirect below) — every other visit serves this same template unmodified.
const verifyTemplate = fs.readFileSync(path.join(__dirname, "verify", "index.html"), "utf8")

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
// The session cookie holds BOTH tokens as JSON: {at: access, rt: refresh}. We
// cache the access token so we only hit Supabase's refresh endpoint when it's
// near expiry — refreshing on every page load rotated the refresh token each
// time, which Supabase can flag as reuse/theft and revoke the whole session.
function setSessionCookie(res, at, rt) {
  const val = encodeURIComponent(JSON.stringify({ at: at, rt: rt }))
  res.append("Set-Cookie", RT_COOKIE + "=" + val + "; " + COOKIE_BASE + "; Max-Age=34560000")
}
function clearSessionCookie(res) {
  res.append("Set-Cookie", RT_COOKIE + "=; " + COOKIE_BASE + "; Max-Age=0")
}

// ── Bind-redirect loop breaker ───────────────────────────────────────────
// Incident (2026-08): an unbound physician got stuck reloading between a
// gated page and /verify/ with no way out. Root cause: the "bind_required"
// redirect below is gated on the DATABASE's line_bind_attempts count, but
// verify/app.js's recordBindFailure() silently swallows any failure to reach
// that RPC and fabricates attempts=3 locally so the CLIENT auto-redirects
// back here — while the server, reading the real (unincremented) DB count,
// sees attempts stuck below the limit and immediately redirects right back
// to /verify/, which auto-runs the bind flow again on load with no tap
// required. Client and server disagreed on the count, and nothing caught it.
//
// This cookie is a hard backstop that does not depend on Supabase, LINE, or
// any client JS being reachable or correct — pure Express state. It counts
// consecutive bind_required redirects for THIS browser and, once BIND_LOOP_MAX
// is hit, serves the page instead of redirecting again, regardless of what
// the DB says. A short Max-Age means a stuck user recovers within minutes
// even if they never revisit; a successful serve always clears it, so a
// later, genuine bind prompt is never permanently suppressed for that browser.
const BIND_LOOP_COOKIE = "p4p_bindloop"
const BIND_LOOP_MAX = 4 // one above the intended 3 real attempts, as slack
function bindLoopCount(req) {
  const n = parseInt(parseCookies(req)[BIND_LOOP_COOKIE], 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}
function bumpBindLoopCookie(res, n) {
  res.append("Set-Cookie", BIND_LOOP_COOKIE + "=" + n + "; " + COOKIE_BASE + "; Max-Age=900")
}
function clearBindLoopCookie(res) {
  res.append("Set-Cookie", BIND_LOOP_COOKIE + "=; " + COOKIE_BASE + "; Max-Age=0")
}
function readSessionCookie(req) {
  const raw = parseCookies(req)[RT_COOKIE]
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    // Valid JSON but no usable refresh token inside — treat as no session
    // rather than falling through to using the raw JSON string itself as a
    // (bogus) refresh token.
    return (o && o.rt) ? { at: o.at || null, rt: o.rt } : null
  } catch (e) {
    // Legacy cookie held a bare refresh token (pre-JSON format).
    return { at: null, rt: raw }
  }
}
// Read a JWT's payload without verifying it (the token itself was already
// validated by Supabase at /auth/session or the refresh call below — this is
// just for reading claims out of a token we already trust).
function jwtPayload(token) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"))
  } catch (e) { return {} }
}
function jwtExp(token) { return typeof jwtPayload(token).exp === "number" ? jwtPayload(token).exp : 0 }

// Resolve a usable access token from the session cookie: reuse the cached one
// while it's fresh, otherwise refresh once (rotating the cookie). Returns
// { at: null, reason } on failure — no cookie ("no_session") or a failed
// refresh ("expired", cookie cleared) — or { at, reason: null } on success.
async function resolveAccessToken(req, res) {
  const sess = readSessionCookie(req)
  if (!sess) return { at: null, reason: "no_session" }

  let at = sess.at
  // Refresh only when the cached access token is missing or within 60s of
  // expiry — so a normal browsing session refreshes ~once an hour, not per page.
  if (!at || jwtExp(at) < Date.now() / 1000 + 60) {
    try {
      const r = await axios.post(
        SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token",
        { refresh_token: sess.rt },
        { headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" }, timeout: 8000 }
      )
      at = r.data && r.data.access_token
      if (!at) throw new Error("no access_token in refresh response")
      setSessionCookie(res, at, r.data.refresh_token || sess.rt)
    } catch (e) {
      clearSessionCookie(res)
      return { at: null, reason: "expired" }
    }
  }
  return { at, reason: null }
}

// Single-round-trip gate check: is this email denylisted, does it have a LINE
// userId bound, how many failed bind attempts, and did THIS SESSION prove its
// LINE identity (scripts/line-bind-verified.sql).
//
// Called with the USER'S access token, not the anon key. The previous version
// used the anon key and passed the email as a parameter, which made the RPC an
// unauthenticated "is this address a registered physician?" oracle — and meant
// it could not be locked down, because revoking anon would 403, get swallowed
// by the catch below, and silently disable the whole gate including the
// denylist. get_line_bind_gate_status_self() takes no argument and reads the
// email from the caller's own JWT, so there is nothing left to enumerate.
// (apikey must still be the publishable key — Supabase requires that header —
// but Authorization is what selects the `authenticated` role.)
//
// Returns null on any error. What that MEANS depends on LINE_BIND_ENFORCE:
// in detect-only mode the caller proceeds (the long-standing fail-open, kept
// so a transient Supabase hiccup can't lock out a whole hospital); with
// enforcement on, the caller refuses to serve the page instead.
async function getLineBindGateStatus(accessToken) {
  try {
    const r = await axios.post(
      SUPABASE_URL + "/rest/v1/rpc/get_line_bind_gate_status_self",
      {},
      { headers: { apikey: SUPABASE_ANON, Authorization: "Bearer " + accessToken, "Content-Type": "application/json" }, timeout: 8000 }
    )
    return (r.data && r.data[0]) || null
  } catch (e) {
    console.error("[gate] get_line_bind_gate_status_self failed:",
      e.response ? e.response.status + " " + JSON.stringify(e.response.data) : e.message)
    return null
  }
}

// Ask LINE whether a LIFF ID token is genuine. LINE checks the signature,
// expiry and audience for us and returns the claims; `sub` is the
// authoritative LINE userId.
//
// This is the whole point of the second factor. liff.getProfile().userId is
// just a string the browser chooses to send — the old bind RPC took it as a
// parameter and believed it. An ID token cannot be forged by the page.
async function verifyLineIdToken(idToken) {
  if (!LINE_LOGIN_CHANNEL_ID) {
    console.error("[line-bind] LINE_LOGIN_CHANNEL_ID is not set — cannot verify ID tokens")
    return null
  }
  try {
    const r = await axios.post(
      "https://api.line.me/oauth2/v2.1/verify",
      new URLSearchParams({ id_token: idToken, client_id: LINE_LOGIN_CHANNEL_ID }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 8000 }
    )
    const sub = r.data && r.data.sub
    if (!sub) {
      console.error("[line-bind] LINE verify returned no sub claim")
      return null
    }
    return { sub: sub, name: (r.data && r.data.name) || null }
  } catch (e) {
    console.error("[line-bind] LINE rejected the id_token:",
      e.response ? JSON.stringify(e.response.data) : e.message)
    return null
  }
}

const BIND_ATTEMPT_LIMIT = 3

// Serve a gated page: require a valid session cookie and inject the current
// access token via <meta> (no inline script -> no CSP change). On top of
// session validity, also enforce the LINE-binding rule: a denylisted email is
// bounced out even with a valid session, and an email with no LINE userId
// bound yet (and still under the retry limit) is routed to /verify/ to
// silently complete that binding using its EXISTING session — no OTP
// re-entry — before it's allowed to reach the actual page.
function servePage(name) {
  return async (req, res) => {
    // Canonicalize to a trailing slash first. LIFF opens "/status" (no slash),
    // but the page's relative <script src="app.js"> only resolves to
    // /status/app.js when the URL ends in "/". Without this the page script
    // 404s and never runs. (express.static used to do this redirect for us.)
    //
    // Every redirect target below ends in a literal "#" for the same reason:
    // LINE's LIFF platform appends "#access_token=...&id_token=..." (its OWN
    // per-LIFF-app session bootstrap, not ours) to the URL when a LIFF app is
    // first opened. A URL fragment is never sent to the server, so we can't
    // see or drop it directly — but if OUR redirect's Location header has no
    // fragment of its own, WebKit (LINE's iOS in-app browser) carries the
    // OLD fragment forward onto the new URL. That stale, wrong-LIFF-app
    // token then rides along into /verify/, where liff.init() sees a
    // mismatch against the (different) LIFF id it's initializing with and
    // fails with "Invalid LIFF ID" — reproducibly, regardless of which LIFF
    // app the physician actually entered through. An explicit trailing "#"
    // gives the browser a fragment of our own (empty) to use, so it stops
    // carrying the old one forward.
    if (!req.path.endsWith("/")) {
      return res.redirect(302, "/" + name + "/" + req.originalUrl.slice(req.path.length) + "#")
    }
    const ret = encodeURIComponent(req.originalUrl)
    const { at, reason } = await resolveAccessToken(req, res)
    if (!at) return res.redirect(302, "/verify/?return=" + ret + "&reason=" + reason + "#")

    const gate = await getLineBindGateStatus(at)

    if (!gate) {
      // Could not confirm the denylist OR the session's LINE proof.
      if (LINE_BIND_ENFORCE) {
        return res.redirect(302, "/verify/?return=" + ret + "&reason=gate_unavailable#")
      }
      // Detect-only mode keeps the historical fail-open. Noted here because it
      // is a real gap while it lasts: a broken gate RPC silently stops
      // blocked_emails from being enforced at all.
    } else {
      if (gate.is_blocked) {
        clearSessionCookie(res)
        return res.redirect(302, "/verify/?reason=blocked#")
      }
      // Signed out, or revoked by an admin: Supabase DELETES the auth.sessions
      // row, so a missing row means this access token outlived its session.
      // Applies in both modes — it is a correctness fix, not part of the second
      // factor. /auth/logout only clears our cookie and never calls Supabase
      // signOut, so before this nothing in the system could really revoke a
      // session; a lifted cookie stayed good until the cached token expired.
      if (gate.session_revoked) {
        clearSessionCookie(res)
        return res.redirect(302, "/verify/?reason=expired#")
      }
      // `enforce_eligible` is true only for emails that have proved their LINE
      // identity through this flow at least once. Without that condition,
      // switching enforcement on would bounce every physician at once if the
      // LIFF app turned out to be missing the `openid` scope — ~200 people
      // locked out of a hospital tool by one env var. Users who have never
      // proved keep the old rules until they do, so the factor phases in.
      const wantsBindRedirect = LINE_BIND_ENFORCE && gate.enforce_eligible
        ? !gate.session_verified
        : !gate.is_bound && gate.attempts < BIND_ATTEMPT_LIMIT

      if (wantsBindRedirect) {
        // Hard backstop, independent of the DB-backed attempts count above
        // (see the comment on BIND_LOOP_COOKIE) — this redirect must never be
        // able to fire more than BIND_LOOP_MAX times in a row for one browser,
        // full stop, regardless of whether Supabase, LINE, or the client's own
        // retry accounting are behaving correctly.
        const loopCount = bindLoopCount(req)
        if (loopCount < BIND_LOOP_MAX) {
          bumpBindLoopCookie(res, loopCount + 1)
          return res.redirect(302, "/verify/?return=" + ret + "&reason=bind_required#")
        }
        console.warn("[bind-loop] backstop tripped for " + name + " — serving unbound rather than redirecting again")
      }
    }

    clearBindLoopCookie(res)
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.send(pageTemplates[name].replace(PAGE_TOKEN_PLACEHOLDER, at))
  }
}

// Security headers for the web UI. The Content-Security-Policy makes the
// email-verification gate more than cosmetic against XSS: script-src is limited
// to our own origin + the Supabase CDN + LINE's LIFF SDK CDN, with NO
// 'unsafe-inline', so an injected <script> or on*="" handler won't execute (all
// page JS was moved to external app.js files for exactly this reason). style-src
// keeps 'unsafe-inline' because the pages set element styles and load Google
// Fonts CSS; connect-src allows the Supabase REST/Realtime endpoints plus the
// LINE API hosts the LIFF SDK calls internally (liff.init / liff.getProfile, used
// on /verify/ to bind a LINE userId to the verified email — see
// scripts/bind-line-user.sql). frame-ancestors is intentionally omitted so the
// pages still load inside LINE's LIFF webview.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' https://cdn.jsdelivr.net https://static.line-scdn.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.line.me https://access.line.me",
].join("; ")
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP)
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  next()
})

// Client posts the tokens from its (working) client-side verifyOtp; we validate
// the access token, then stash the refresh token in an HttpOnly cookie.
app.post("/auth/session", express.json({ limit: "8kb" }), async (req, res) => {
  const { access_token, refresh_token } = req.body || {}
  if (!access_token || !refresh_token) return res.status(400).json({ error: "missing tokens" })
  try {
    await axios.get(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_ANON, Authorization: "Bearer " + access_token }, timeout: 8000,
    })
  } catch (e) {
    return res.status(401).json({ error: "invalid token" })
  }
  setSessionCookie(res, access_token, refresh_token)
  res.json({ ok: true })
})
app.post("/auth/logout", (req, res) => { clearSessionCookie(res); res.json({ ok: true }) })

// Bind (or re-prove) the caller's LINE identity — the second factor.
//
// Both identities are established SERVER-SIDE here, and neither is taken on
// trust from the request body:
//   who they are in P4P   -> Supabase validates the access token
//   who they are on LINE  -> LINE validates the ID token, and its `sub` claim
//                            is the userId we store/compare
// The DB function is service_role-only, so a browser cannot reach it directly
// and cannot assert a LINE userId of its own choosing the way the old
// bind_line_user_id(p_line_user_id) allowed.
app.post("/line/bind", express.json({ limit: "8kb" }), async (req, res) => {
  const authHeader = req.headers.authorization || ""
  const at = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  const idToken = (req.body && req.body.id_token) || ""
  if (!at || !idToken) return res.status(400).json({ error: "missing token" })

  // 1. Validate the session against Supabase rather than reading the JWT body —
  //    this endpoint decides who a LINE account gets attached to, so the email
  //    must come from an authority, not from an unverified claim.
  let email = null
  try {
    const u = await axios.get(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_ANON, Authorization: "Bearer " + at }, timeout: 8000,
    })
    email = u.data && u.data.email
  } catch (e) {
    return res.status(401).json({ error: "invalid session" })
  }
  if (!email) return res.status(401).json({ error: "no email on session" })

  // 2. Validate the LINE ID token with LINE.
  const line = await verifyLineIdToken(idToken)
  if (!line) return res.status(401).json({ error: "line verification failed" })

  // Without a session_id there is nothing to attach the proof to, so
  // get_line_bind_gate_status_self would keep reporting session_verified=false
  // and — with enforcement on — bounce the user straight back here forever.
  // Fail loudly instead: an infinite redirect inside LINE's webview is close to
  // undebuggable from the physician's side. session_id is a required claim on
  // every Supabase access token, so this should be unreachable.
  const sessionId = jwtPayload(at).session_id || null
  if (!sessionId) {
    console.error("[line-bind] access token has no session_id claim — cannot record proof")
    return res.status(500).json({ error: "no session_id on token" })
  }

  // 3. Record it. session_id ties the proof to THIS session; it is a required
  //    claim on every Supabase access token and is stable across refreshes, so
  //    a physician proves once per session rather than once per page load.
  try {
    const r = await axios.post(
      SUPABASE_URL + "/rest/v1/rpc/bind_line_user_id_verified",
      {
        p_email: email,
        p_line_user_id: line.sub,
        p_line_display_name: line.name,
        p_session_id: sessionId,
      },
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
        timeout: 8000,
      }
    )
    const status = (r.data && r.data.status) || "error"
    console.log("[line-bind] " + email + " -> " + status)
    if (status === "mismatch") return res.status(403).json({ status: status })
    if (status === "bound" || status === "match") return res.json({ status: status })
    return res.status(500).json({ status: status })
  } catch (e) {
    console.error("[line-bind] bind RPC failed:",
      e.response ? e.response.status + " " + JSON.stringify(e.response.data) : e.message)
    return res.status(500).json({ error: "bind failed" })
  }
})

// Receives Telegram's "callback_query" webhook when an admin taps ✅/❌ on the
// access-request alert (buttons added by scripts/telegram-approve-buttons.sql).
// Uses the Supabase SERVICE ROLE key to call the approve/reject RPC — that key
// never leaves this server.
app.post("/telegram/webhook", express.json({ limit: "64kb" }), async (req, res) => {
  const receivedSecret = (req.headers["x-telegram-bot-api-secret-token"] || "").trim()
  const expectedSecret = (TELEGRAM_WEBHOOK_SECRET || "").trim()
  console.log("[tg-webhook] received. secret header present:", !!req.headers["x-telegram-bot-api-secret-token"])

  // Telegram echoes back the secret set via setWebhook in this header — the
  // only real proof a request came from Telegram and not a guessed URL. Trim
  // both sides so an accidental trailing space/newline (easy to introduce
  // pasting a long value into Vercel's env var UI) doesn't cause a false
  // mismatch. Log LENGTHS only (never the values) — a length mismatch is a
  // strong sign of a copy-paste truncation between where the secret was set
  // (Vercel) and where it was registered (the setWebhook call).
  if (receivedSecret !== expectedSecret) {
    console.log(
      "[tg-webhook] REJECTED: secret mismatch. received len=" + receivedSecret.length +
      " expected len=" + expectedSecret.length + " (configured=" + !!TELEGRAM_WEBHOOK_SECRET + ")"
    )
    return res.sendStatus(401)
  }

  const cb = req.body && req.body.callback_query
  if (!cb || !cb.data) {
    console.log("[tg-webhook] no callback_query.data in body — update type:", Object.keys(req.body || {}).join(","))
    return res.sendStatus(200)
  }
  const [action, token] = String(cb.data).split("|")
  // Log only a token prefix — it's a single-use approve/reject token for
  // access_requests, not a long-lived secret, but there's no reason to put
  // the full value in Vercel's logs when a prefix is enough to correlate.
  const tokenPreview = token ? token.slice(0, 8) + "…" : token
  console.log("[tg-webhook] callback_data action:", action, "token:", tokenPreview)
  if (!token || (action !== "appr" && action !== "rej")) {
    console.log("[tg-webhook] REJECTED: unparseable callback_data")
    return res.sendStatus(200)
  }

  const tg = (method, body) =>
    axios.post("https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/" + method, body, { timeout: 8000 })
      .then((r) => { console.log("[tg-webhook] telegram." + method + " ok:", JSON.stringify(r.data)); return r })
      .catch((e) => {
        console.error("[tg-webhook] telegram." + method + " FAILED:",
          e.response ? JSON.stringify(e.response.data) : e.message)
      })

  try {
    const fn = action === "appr" ? "approve_access_request" : "reject_access_request"
    console.log("[tg-webhook] calling Supabase RPC:", fn, "with token:", tokenPreview)
    const r = await axios.post(
      SUPABASE_URL + "/rest/v1/rpc/" + fn,
      { p_token: token },
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
        timeout: 8000,
      }
    )
    console.log("[tg-webhook] RPC response:", JSON.stringify(r.data))
    const ok = r.data === true

    await tg("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: ok
        ? (action === "appr" ? "อนุมัติแล้ว" : "ปฏิเสธคำขอแล้ว")
        : "คำขอนี้ถูกดำเนินการไปแล้ว หรือไม่พบข้อมูล",
    })

    if (ok && cb.message) {
      const suffix = action === "appr" ? "\n\n✅ อนุมัติแล้ว" : "\n\n❌ ปฏิเสธแล้ว"
      await tg("editMessageText", {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: (cb.message.text || "") + suffix,
        reply_markup: { inline_keyboard: [] },
      })
    }
  } catch (e) {
    console.error("[tg-webhook] RPC call FAILED:",
      e.response ? e.response.status + " " + JSON.stringify(e.response.data) : e.message)
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "เกิดข้อผิดพลาด กรุณาลองใหม่" })
  }

  console.log("[tg-webhook] handler complete, responding 200")
  // Respond only after ALL Telegram/Supabase calls finish. Vercel's serverless
  // runtime can freeze the function the instant a response is sent — an early
  // ack (the previous version of this code) let the platform kill
  // answerCallbackQuery/editMessageText before they completed, which is why the
  // button spinner would time out with no confirmation ever showing.
  res.sendStatus(200)
})

// Gated pages: server-validated + token injected (must be registered BEFORE the
// static mounts so "/status/" hits the handler, while "/status/app.js" etc.
// fall through to the static mount below).
for (const p of gatedPages) {
  app.get(["/" + p, "/" + p + "/"], servePage(p))
}

// /verify/ itself: for everyone this is the normal unauthenticated page
// (served byte-identical to the plain static file). The ONE exception is the
// "bind_required" bounce from servePage() above — a session that's valid but
// still needs its LINE userId bound. In that case only, inject the existing
// access token so the page can silently complete the bind (see verify/app.js)
// without making the physician re-enter their email/OTP. Registered before
// the static mount below for the same reason as the gated pages.
app.get(["/verify", "/verify/"], async (req, res) => {
  // NO trailing-slash redirect here — this page is served identically at both
  // /verify and /verify/.
  //
  // Incident (2026-08): unbound physicians hit an endless /verify -> /verify/
  // reload. This handler used to 302 the no-slash URL to "/verify/…#", and
  // that explicit "#" was the bug: LIFF navigates to its registered Endpoint
  // URL with "#access_token=…" appended to complete login, and the redirect
  // replaced that fragment with an empty one. liff.init() then found no login
  // state, restarted login, landed back on /verify, and got stripped again —
  // forever. Vercel logs showed the cycle plainly, with no POST /line/bind
  // ever reached.
  //
  // It only surfaced when the `openid` scope was added: that invalidated
  // existing LIFF consent, so init() started needing a real login round-trip
  // instead of restoring from cache. The stripping bug was already here.
  //
  // Serving both paths keeps the fragment intact (no navigation at all), and
  // verify/index.html now loads /verify/app.js absolutely so the no-slash URL
  // resolves its script correctly — that 404 was the redirect's only purpose.
  //
  // The OTHER trailing-"#" redirects (servePage, for /status /list /ranking)
  // are deliberately untouched: those clear a genuinely stale fragment left by
  // a DIFFERENT LIFF app, which is a real problem and a different one.
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  if (req.query.reason !== "bind_required") {
    return res.send(verifyTemplate)
  }
  const { at } = await resolveAccessToken(req, res)
  res.send(at ? verifyTemplate.replace(PAGE_TOKEN_PLACEHOLDER, at) : verifyTemplate)
})

app.use("/status", express.static("status"))
app.use("/list", express.static("list"))
app.use("/ranking", express.static("ranking"))
app.use("/verify", express.static("verify"))
app.use("/assets", express.static("assets"))

app.post("/line", line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err)
      res.status(500).end()
    })
})

const handleEvent = async (event) => {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null)
  }
  try {
    await axios.post("https://api.line.me/v2/bot/chat/loading/start",
      { "chatId": event.source.userId },
      { headers: headers }
    )
  } catch (error) {
    console.error(error)
  }
  const message = event.message.text.trim().toLowerCase()
  if (message === "status") {
    return client.replyMessage({
      "replyToken": event.replyToken,
      "messages": [createStatusList()]
    })
  }
  if (message === "myid") {
    return client.replyMessage({
      "replyToken": event.replyToken,
      "messages": [{ "type": "text", "text": event.source.userId }]
    })
  }
  return Promise.resolve(null)
}

const createStatusList = () => {
  const object = {
    "type": "flex",
    "altText": "เลือกเดือนที่ต้องการ",
    "contents": {
      "type": "bubble",
      "size": "mega",
      "header": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "text",
                "text": "กรุณาเลือกเดือน",
                "align": "center",
                "color": "#FFFFFF",
                "size": "xxl",
                "margin": "md",
                "offsetBottom": "sm",
                "weight": "bold",
              },
              {
                "type": "text",
                "text": "สามารถดูได้ 6 เดือนย้อนหลัง",
                "color": "#ffffa0",
                "align": "center",
              },
            ],
          },
        ],
        "backgroundColor": "#4B3D33",
        "paddingAll": "xxl",
      },
      "hero": {
        "type": "box",
        "layout": "vertical",
        "contents": [],
        "height": "5px",
        "backgroundColor": "#81A7AE",
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          createStatusSublist(0),
          createStatusSublist(1),
          createStatusSublist(2),
          createStatusSublist(3),
          createStatusSublist(4),
          createStatusSublist(5),
        ],
        "backgroundColor": "#F5F5F0",
      }
    }
  }
  return object
}

const createStatusSublist = (i) => {
  const now = new Date()
  const month = now.getMonth()
  const year = now.getFullYear() + 543
  const iterator = month_iterator[month]
  const name = month_array[iterator[i][0]] + " " + (year + iterator[i][1])
  const color_hex = color_array[iterator[i][0]][1]
  const color_tw = color_array[iterator[i][0]][0]
  const sheetname = (year + iterator[i][1]) + "_" + String(iterator[i][0] + 1).padStart(2, '0')
  const object = {
    "type": "box",
    "layout": "horizontal",
    "contents": [
      {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": name,
            "align": "center",
            "size": "lg",
            "style": "italic",
            "weight": "bold",
          },
        ],
        "backgroundColor": color_hex,
        "cornerRadius": "sm",
        "borderColor": color_hex,
        "borderWidth": "semi-bold",
        "flex": 3,
        "paddingAll": "md",
      },
      {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "คลิก",
            "align": "center",
            "weight": "bold",
            "size": "lg",
            "color": "#412D11",
          },
        ],
        "backgroundColor": "#f5f5f5",
        "cornerRadius": "md",
        "offsetEnd": "md",
        "borderColor": "#412D11",
        "borderWidth": "semi-bold",
        "flex": 1,
        "paddingAll": "md",
        "action": {
          "type": "uri",
          "label": sheetname,
          "uri": "https://liff.line.me/2008561527-a0xP1XmY?sheetname=" +
            sheetname +
            "&color=" + color_tw,
        },
      },
    ],
    "paddingBottom": "xxl",
    "paddingTop": "xxl",
  }
  return object
}

// On Vercel the exported app is used as the serverless handler.
// app.listen only runs for local dev (node main.js).
if (require.main === module) {
  app.listen(port, () => { console.log("P4P server is live") })
}

module.exports = app

