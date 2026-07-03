const express = require("express")
const process = require("node:process")
const line = require("@line/bot-sdk")
const axios = require("axios")
const app = express()

const port = process.env.PORT || 3000
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET

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
function setRt(res, rt) {
  res.append("Set-Cookie", RT_COOKIE + "=" + encodeURIComponent(rt) + "; " + COOKIE_BASE + "; Max-Age=34560000")
}
function clearRt(res) {
  res.append("Set-Cookie", RT_COOKIE + "=; " + COOKIE_BASE + "; Max-Age=0")
}

// Serve a gated page: require a valid refresh cookie, exchange it for a fresh
// access token, rotate the cookie, and inject the token via <meta> (no inline
// script -> no CSP change). No/invalid cookie -> redirect to /verify/.
function servePage(name) {
  return async (req, res) => {
    const ret = encodeURIComponent(req.originalUrl)
    const rt = parseCookies(req)[RT_COOKIE]
    if (!rt) return res.redirect(302, "/verify/?return=" + ret + "&reason=no_session")
    let at
    try {
      const r = await axios.post(
        SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token",
        { refresh_token: rt },
        { headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" }, timeout: 8000 }
      )
      at = r.data && r.data.access_token
      if (!at) throw new Error("no access_token in refresh response")
      setRt(res, r.data.refresh_token || rt) // rotate
    } catch (e) {
      clearRt(res)
      return res.redirect(302, "/verify/?return=" + ret + "&reason=expired")
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.send(pageTemplates[name].replace(PAGE_TOKEN_PLACEHOLDER, at))
  }
}

// Security headers for the web UI. The Content-Security-Policy makes the
// email-verification gate more than cosmetic against XSS: script-src is limited
// to our own origin + the Supabase CDN, with NO 'unsafe-inline', so an injected
// <script> or on*="" handler won't execute (all page JS was moved to external
// app.js files for exactly this reason). style-src keeps 'unsafe-inline' because
// the pages set element styles and load Google Fonts CSS; connect-src allows the
// Supabase REST/Realtime endpoints. frame-ancestors is intentionally omitted so
// the pages still load inside LINE's LIFF webview.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
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
  setRt(res, refresh_token)
  res.json({ ok: true })
})
app.post("/auth/logout", (req, res) => { clearRt(res); res.json({ ok: true }) })

// Gated pages: server-validated + token injected (must be registered BEFORE the
// static mounts so "/status/" hits the handler, while "/status/app.js" etc.
// fall through to the static mount below).
for (const p of gatedPages) {
  app.get(["/" + p, "/" + p + "/"], servePage(p))
}

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

