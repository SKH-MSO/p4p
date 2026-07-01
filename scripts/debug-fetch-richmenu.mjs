import { writeFileSync } from 'node:fs'
import axios from 'axios'

// One-off diagnostic: download whatever PNG is actually live on LINE right
// now for the given rich menu alias, so it can be compared byte-for-byte
// against a local re-render. Not part of the normal deploy pipeline.
const TOKEN = process.env.LINE_TOKEN
if (!TOKEN) { console.error('Missing LINE_TOKEN env var'); process.exit(1) }

const API      = 'https://api.line.me'
const DATA_API = 'https://api-data.line.me'
const authHdr  = { Authorization: `Bearer ${TOKEN}` }

const alias = process.argv[2] || 'month-picker'

const { data: { richMenuId } } = await axios.get(
  `${API}/v2/bot/richmenu/alias/${alias}`, { headers: authHdr }
)
console.log(`alias "${alias}" -> richMenuId ${richMenuId}`)

const res = await axios.get(
  `${DATA_API}/v2/bot/richmenu/${richMenuId}/content`,
  { headers: authHdr, responseType: 'arraybuffer' }
)
writeFileSync('richmenu-live.png', res.data)
console.log(`Saved richmenu-live.png (${res.data.length} bytes)`)
