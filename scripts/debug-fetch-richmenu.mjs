import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import axios from 'axios'
import sharp from 'sharp'
import { getMonthData, generateSVG } from './update-month-picker.mjs'
import { svgToPng } from './render.mjs'

// One-off diagnostic: download whatever PNG is actually live on LINE right
// now for the given rich menu alias, regenerate what the current code would
// produce for it, and diff the two — no image viewing required, just a
// plain-text verdict in the job log. Not part of the normal deploy pipeline.
const TOKEN = process.env.LINE_TOKEN
if (!TOKEN) { console.error('Missing LINE_TOKEN env var'); process.exit(1) }

const API      = 'https://api.line.me'
const DATA_API = 'https://api-data.line.me'
const authHdr  = { Authorization: `Bearer ${TOKEN}` }

const alias = process.argv[2] || 'month-picker'
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const { data: { richMenuId } } = await axios.get(
  `${API}/v2/bot/richmenu/alias/${alias}`, { headers: authHdr }
)
console.log(`alias "${alias}" -> richMenuId ${richMenuId}`)

const res = await axios.get(
  `${DATA_API}/v2/bot/richmenu/${richMenuId}/content`,
  { headers: authHdr, responseType: 'arraybuffer' }
)
const livePng = Buffer.from(res.data)
writeFileSync('richmenu-live.png', livePng)
console.log(`Live image: ${livePng.length} bytes, sha256 ${sha256(livePng)}`)

if (alias !== 'month-picker') {
  console.log('Only "month-picker" has a deterministic local regeneration path — skipping diff.')
  process.exit(0)
}

const expectedPng = svgToPng(generateSVG(getMonthData()))
console.log(`Expected image (regenerated now): ${expectedPng.length} bytes, sha256 ${sha256(expectedPng)}`)

if (Buffer.compare(livePng, expectedPng) === 0) {
  console.log('VERDICT: IDENTICAL — the live image byte-for-byte matches what the current code produces.')
  process.exit(0)
}

console.log('VERDICT: DIFFERENT bytes — decoding pixels to compare...')
const liveRaw     = await sharp(livePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const expectedRaw = await sharp(expectedPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

if (liveRaw.info.width !== expectedRaw.info.width || liveRaw.info.height !== expectedRaw.info.height) {
  console.log(`Dimensions differ: live ${liveRaw.info.width}x${liveRaw.info.height} vs expected ${expectedRaw.info.width}x${expectedRaw.info.height}`)
  process.exit(0)
}

const { width, height } = liveRaw.info
const a = liveRaw.data, b = expectedRaw.data
let diffPixels = 0
const THRESH = 10
for (let i = 0; i < a.length; i += 4) {
  if (Math.abs(a[i] - b[i]) > THRESH || Math.abs(a[i + 1] - b[i + 1]) > THRESH || Math.abs(a[i + 2] - b[i + 2]) > THRESH) {
    diffPixels++
  }
}
const totalPixels = width * height
console.log(`Pixel diff: ${diffPixels} / ${totalPixels} (${((diffPixels / totalPixels) * 100).toFixed(2)}%) pixels differ by more than ${THRESH}/255 per channel`)
console.log(diffPixels === 0
  ? 'VERDICT: pixel-identical despite different encoding — cosmetic only, no rendering bug.'
  : 'VERDICT: genuinely different image content — real rendering discrepancy between live and current code.')
