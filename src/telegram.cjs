// Telegram approve/reject webhook handler, extracted from main.js so the HTTP
// wiring stays thin and this piece is testable in isolation. Secrets are passed
// in (not read from process.env here) to keep the module env-agnostic.
const axios = require("axios")
const { rpc } = require("./supabase.cjs")

// Builds the Express handler for Telegram's "callback_query" webhook — fired
// when an admin taps ✅/❌ on an access-request alert (buttons from
// scripts/telegram-approve-buttons.sql). Calls the approve/reject RPC with the
// Supabase SERVICE ROLE key, which bypasses RLS and never leaves the server.
function telegramWebhookHandler({ botToken, webhookSecret, serviceRoleKey }) {
  return async (req, res) => {
    const receivedSecret = (req.headers["x-telegram-bot-api-secret-token"] || "").trim()
    const expectedSecret = (webhookSecret || "").trim()
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
        " expected len=" + expectedSecret.length + " (configured=" + !!webhookSecret + ")"
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
      axios.post("https://api.telegram.org/bot" + botToken + "/" + method, body, { timeout: 8000 })
        .then((r) => { console.log("[tg-webhook] telegram." + method + " ok:", JSON.stringify(r.data)); return r })
        .catch((e) => {
          console.error("[tg-webhook] telegram." + method + " FAILED:",
            e.response ? JSON.stringify(e.response.data) : e.message)
        })

    try {
      const fn = action === "appr" ? "approve_access_request" : "reject_access_request"
      console.log("[tg-webhook] calling Supabase RPC:", fn, "with token:", tokenPreview)
      const r = await rpc(fn, { p_token: token }, serviceRoleKey)
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
    // ack (a previous version of this code) let the platform kill
    // answerCallbackQuery/editMessageText before they completed, which is why the
    // button spinner would time out with no confirmation ever showing.
    res.sendStatus(200)
  }
}

module.exports = { telegramWebhookHandler }
