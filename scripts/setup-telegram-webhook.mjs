/**
 * setup-telegram-webhook.mjs
 *
 * One-time: registers this app's /telegram/webhook URL with Telegram so button
 * clicks on the access-request alert (scripts/telegram-approve-buttons.sql) get
 * delivered. Re-run any time the deployed URL or webhook secret changes.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
 *     node scripts/setup-telegram-webhook.mjs https://your-app.vercel.app
 */
import axios from "axios"

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET
const baseUrl = process.argv[2]

if (!TOKEN) { console.error("Missing TELEGRAM_BOT_TOKEN env var"); process.exit(1) }
if (!SECRET) { console.error("Missing TELEGRAM_WEBHOOK_SECRET env var"); process.exit(1) }
if (!baseUrl) { console.error("Usage: node scripts/setup-telegram-webhook.mjs https://your-app.vercel.app"); process.exit(1) }

const webhookUrl = baseUrl.replace(/\/$/, "") + "/telegram/webhook"

const { data } = await axios.post(`https://api.telegram.org/bot${TOKEN}/setWebhook`, {
  url: webhookUrl,
  secret_token: SECRET,
  allowed_updates: ["callback_query"], // this bot only needs button clicks
})

if (!data.ok) {
  console.error("setWebhook failed:", data)
  process.exit(1)
}
console.log(`✓ Telegram webhook registered: ${webhookUrl}`)

const info = await axios.get(`https://api.telegram.org/bot${TOKEN}/getWebhookInfo`)
console.log("Webhook info:", JSON.stringify(info.data.result, null, 2))
