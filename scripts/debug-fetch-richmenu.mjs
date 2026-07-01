import { writeFileSync } from 'node:fs'
import axios from 'axios'
import sharp from 'sharp'

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

// Also print a small base64 crop straight into the job log — artifact
// downloads land on a blob-storage host that isn't always reachable, but
// job logs go through the GitHub API, which is.
const crop = await sharp(Buffer.from(res.data))
  .extract({ left: 0, top: 0, width: 833, height: 620 })
  .resize(300)
  .png()
  .toBuffer()
console.log(`--- BASE64 CROP START (${crop.length} bytes) ---`)
console.log(crop.toString('base64'))
console.log('--- BASE64 CROP END ---')
