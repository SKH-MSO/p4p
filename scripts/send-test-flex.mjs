/**
 * One-off: push the latest feature carousel to a single LINE user.
 * Usage:
 *   $env:LINE_ACCESS_TOKEN="<token>"; $env:LINE_USER_ID="<Uxxxxxxx>"; node scripts/send-test-flex.mjs [version]
 *
 * version defaults to v1.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const token  = process.env.LINE_ACCESS_TOKEN
const userId = process.env.LINE_USER_ID
const ver    = process.argv[2] ?? 'v1'

if (!token)  { console.error('Set LINE_ACCESS_TOKEN'); process.exit(1) }
if (!userId) { console.error('Set LINE_USER_ID');      process.exit(1) }

const jsonPath = join(__dirname, `../assets/cards/feature-carousel.${ver}.flex.json`)
const message  = JSON.parse(readFileSync(jsonPath, 'utf-8'))

const res = await fetch('https://api.line.me/v2/bot/message/push', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ to: userId, messages: [message] }),
})

const body = await res.json()
if (res.ok) {
  console.log(`✓ sent ${ver} carousel to ${userId}`)
} else {
  console.error('LINE API error:', JSON.stringify(body, null, 2))
}
