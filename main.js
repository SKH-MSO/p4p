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
const { BIND_ATTEMPT_LIMIT, BOUNCE_REASONS } = require("./src/constants.cjs")
// Supabase project config + a thin PostgREST RPC helper (one shared header shape).
const { SUPABASE_URL, SUPABASE_ANON, rpc } = require("./src/supabase.cjs")
// Cookie + JWT helpers live in src/session.cjs so they can be unit-tested
// without booting Express (see test/session.test.cjs).
const {
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  jwtExp,
  jwtEmail,
} = require("./src/session.cjs")
// LINE Flex "choose a month" picker builder and the Telegram approve/reject
// webhook handler live in their own modules — main.js stays HTTP wiring.
const { createStatusList } = require("./src/flex.cjs")
const { telegramWebhookHandler } = require("./src/telegram.cjs")

// ── Server-side session validation ───────────────────────────────────────
// The LINE (LIFF) in-app browser does not persist a client-side Supabase
// session across navigations, so the browser can't hold the auth token. Instead
// the SERVER validates the session: after the client verifies its OTP it posts
// the tokens here; we keep the refresh token in an HttpOnly cookie and, on every
// gated page request, exchange it for a fresh access token which we inject into
// the page. The browser only ever holds a short-lived access token in memory.
const fs = require("node:fs")
const path = require("node:path")
const PAGE_TOKEN_PLACEHOLDER = "__P4P_ACCESS_TOKEN__"

// Per-deploy asset version, stamped onto every <script src> query string
// (?v=__ASSET_VERSION__) in the page templates. It changes on each deploy, so a
// new HTML always points at fresh JS URLs — preventing the deploy race where a
// browser pairs a new app.js with a stale cached shared.js (the /verify crash).
// On Vercel this is the commit SHA; locally it's a per-start timestamp.
const ASSET_VERSION = process.env.VERCEL_GIT_COMMIT_SHA
  ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8)
  : String(Date.now())
const stampVersion = (html) => html.replace(/__ASSET_VERSION__/g, ASSET_VERSION)

// Gated pages cached as templates; the server fills the token placeholder per
// request. Files never change at runtime, so the version stamp is baked in once.
const gatedPages = ["status", "list", "ranking"]
const pageTemplates = {}
for (const p of gatedPages) {
  pageTemplates[p] = stampVersion(fs.readFileSync(path.join(__dirname, p, "index.html"), "utf8"))
}
// /verify/ also carries the same <meta name="p4p-session"> placeholder, used
// only for the silent LINE-bind bounce (see servePage's "bind_required"
// redirect below) — every other visit serves this same template unmodified.
const verifyTemplate = stampVersion(fs.readFileSync(path.join(__dirname, "verify", "index.html"), "utf8"))

// Resolve a usable access token from the session cookie: reuse the cached one
// while it's fresh, otherwise refresh once (rotating the cookie). Returns
// { at: null, reason } on failure — no cookie ("no_session") or a failed
// refresh ("expired", cookie cleared) — or { at, reason: null } on success.
async function resolveAccessToken(req, res) {
  const sess = readSessionCookie(req)
  if (!sess) return { at: null, reason: BOUNCE_REASONS.NO_SESSION }

  let at = sess.at
  // Refresh only when the cached access token is missing or within 60s of
  // expiry — so a normal browsing session refreshes ~once an hour, not per page.
  //
  // CONCURRENCY: near expiry, two near-simultaneous requests (page load +
  // /auth/token, or rapid navigation) can both read the same refresh token and
  // both POST a refresh. Supabase rotates the refresh token on first use and
  // would flag the second as reuse — revoking the whole session — WERE IT NOT
  // for its "refresh token reuse interval" (default 10s), which hands the same
  // new token back to both callers. That grace window is what makes this safe:
  // keep it enabled (see OPERATIONS.md). On Vercel's serverless runtime, function
  // instances don't share memory, so an in-process lock can't close this race —
  // the reuse interval is the real safeguard.
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
    } catch {
      clearSessionCookie(res)
      return { at: null, reason: BOUNCE_REASONS.EXPIRED }
    }
  }
  return { at, reason: null }
}

// Single-round-trip check against scripts/line-bind-gate.sql's
// get_line_bind_gate_status RPC: is this email denylisted, does it already
// have a LINE userId bound, and how many failed bind attempts so far. Uses
// the anon key (same posture as is_sender_allowlisted — a yes/no/count
// oracle callable pre-login, never exposes the underlying rows). Fails OPEN
// (returns null) on any error — a transient Supabase hiccup must not lock
// everyone out of pages they already have a valid session for; the
// underlying data queries are still protected by RLS regardless.
async function getLineBindGateStatus(email) {
  try {
    const r = await rpc("get_line_bind_gate_status", { p_email: email })
    return (r.data && r.data[0]) || null
  } catch (e) {
    // Fail open, but LOG it: combined with record_bind_failure() also failing
    // open (verify/app.js), a Supabase outage lets a valid session skip LINE
    // binding entirely. That's the intended posture ("never lock a physician
    // out over an infra blip"), but it should be visible when it happens rather
    // than degrading silently.
    console.warn("[gate] get_line_bind_gate_status failed, failing open:", e.message)
    return null
  }
}

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

    const email = jwtEmail(at)
    if (email) {
      const gate = await getLineBindGateStatus(email)
      if (gate) {
        if (gate.is_blocked) {
          clearSessionCookie(res)
          return res.redirect(302, "/verify/?reason=" + BOUNCE_REASONS.BLOCKED + "#")
        }
        if (!gate.is_bound && gate.attempts < BIND_ATTEMPT_LIMIT) {
          return res.redirect(302, "/verify/?return=" + ret + "&reason=" + BOUNCE_REASONS.BIND_REQUIRED + "#")
        }
      }
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8")
    // The page embeds a live access token in <meta> — never let it be cached.
    res.setHeader("Cache-Control", "no-store")
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
  } catch {
    return res.status(401).json({ error: "invalid token" })
  }
  setSessionCookie(res, access_token, refresh_token)
  res.json({ ok: true })
})
app.post("/auth/logout", (req, res) => { clearSessionCookie(res); res.json({ ok: true }) })

// Fresh-access-token endpoint for long-open pages. auth-guard.js calls this
// when its in-memory token nears expiry: resolveAccessToken re-derives a valid
// access token from the HttpOnly cookie (refreshing + rotating it if needed),
// so a page open past the ~1h token TTL keeps working instead of 401-ing. No
// body, same-origin, cookie-authenticated; returns 401 when there's no usable
// session so the client stops rather than looping.
app.get("/auth/token", async (req, res) => {
  // A bearer token must never sit in a cache (browser heuristic or proxy).
  res.setHeader("Cache-Control", "no-store")
  const { at } = await resolveAccessToken(req, res)
  if (!at) return res.status(401).json({ error: BOUNCE_REASONS.NO_SESSION })
  res.json({ access_token: at })
})

// Telegram approve/reject webhook (admin taps ✅/❌ on an access-request alert).
// The handler itself lives in src/telegram.cjs; secrets are injected here.
app.post("/telegram/webhook", express.json({ limit: "64kb" }), telegramWebhookHandler({
  botToken: TELEGRAM_BOT_TOKEN,
  webhookSecret: TELEGRAM_WEBHOOK_SECRET,
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
}))

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
  if (!req.path.endsWith("/")) {
    // Trailing "#" clears any stale LIFF session fragment carried over from
    // the referring page — see the comment in servePage() above.
    return res.redirect(302, "/verify/" + req.originalUrl.slice(req.path.length) + "#")
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  // Never cache the verify HTML: it carries the per-deploy ?v= asset stamps, so
  // a cached copy would keep pointing browsers at stale JS. The bind_required
  // branch also injects a live token. Tiny page — no-store is cheap.
  res.setHeader("Cache-Control", "no-store")
  if (req.query.reason !== BOUNCE_REASONS.BIND_REQUIRED) {
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

// On Vercel the exported app is used as the serverless handler.
// app.listen only runs for local dev (node main.js).
if (require.main === module) {
  app.listen(port, () => { console.log("P4P server is live") })
}

module.exports = app

