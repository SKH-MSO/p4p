import { fileURLToPath } from 'node:url'
import axios from 'axios'
import { svgToPng } from './render.mjs'

const TOKEN = process.env.LINE_TOKEN

const API      = 'https://api.line.me'
const DATA_API = 'https://api-data.line.me'
const authHdr  = { Authorization: `Bearer ${TOKEN}` }
const jsonHdr  = { ...authHdr, 'Content-Type': 'application/json' }

const log = (m) => process.stdout.write(`${m}\n`)
const ok  = (m) => log(`✓ ${m}`)

// ── Shared data (mirrors main.js) ─────────────────────────────────────────────
const COLOR_ARRAY = [
  ['bg-red-300',     '#ffa2a2'],
  ['bg-orange-300',  '#ffb86a'],
  ['bg-yellow-300',  '#ffdf20'],
  ['bg-lime-300',    '#bbf451'],
  ['bg-green-300',   '#7bf1a8'],
  ['bg-teal-300',    '#46ecd5'],
  ['bg-cyan-300',    '#53eafd'],
  ['bg-sky-300',     '#74d4ff'],
  ['bg-blue-300',    '#8ec5ff'],
  ['bg-indigo-300',  '#a3b3ff'],
  ['bg-violet-300',  '#c4b4ff'],
  ['bg-fuchsia-300', '#f4a8ff'],
]
const MONTH_NAMES = [
  'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม',
]
const MONTH_ITERATOR = [
  [[0,0],[11,-1],[10,-1],[9,-1],[8,-1],[7,-1]],
  [[1,0],[0,0],[11,-1],[10,-1],[9,-1],[8,-1]],
  [[2,0],[1,0],[0,0],[11,-1],[10,-1],[9,-1]],
  [[3,0],[2,0],[1,0],[0,0],[11,-1],[10,-1]],
  [[4,0],[3,0],[2,0],[1,0],[0,0],[11,-1]],
  [[5,0],[4,0],[3,0],[2,0],[1,0],[0,0]],
  [[6,0],[5,0],[4,0],[3,0],[2,0],[1,0]],
  [[7,0],[6,0],[5,0],[4,0],[3,0],[2,0]],
  [[8,0],[7,0],[6,0],[5,0],[4,0],[3,0]],
  [[9,0],[8,0],[7,0],[6,0],[5,0],[4,0]],
  [[10,0],[9,0],[8,0],[7,0],[6,0],[5,0]],
  [[11,0],[10,0],[9,0],[8,0],[7,0],[6,0]],
]

// ── Layout constants — 2500 × 1686 (large, easy to read) ─────────────────────
const COLS   = [{ x: 0, w: 833 }, { x: 833, w: 834 }, { x: 1667, w: 833 }]
const ROW_H  = 620
const ROWS   = [{ y: 0 }, { y: 620 }]
const BACK_Y = 1240
const BACK_H = 446  // 1240 + 446 = 1686 ✓

// ── Calculate 6 months for the given JS month index (0–11) ───────────────────
export function getMonthData(monthIndex = new Date().getMonth()) {
  const beYear = new Date().getFullYear() + 543
  return MONTH_ITERATOR[monthIndex].map(([mIdx, yOff]) => ({
    name:     MONTH_NAMES[mIdx],
    year:     beYear + yOff,
    colorHex: COLOR_ARRAY[mIdx][1],
    colorTw:  COLOR_ARRAY[mIdx][0],
    sheet:    `${beYear + yOff}_${String(mIdx + 1).padStart(2, '0')}`,
  }))
}

// ── Generate month-picker SVG (2500 × 1686) ──────────────────────────────────
export function generateSVG(months) {
  const cells = months.map((m, i) => {
    const { x, w } = COLS[i % 3]
    const { y }    = ROWS[Math.floor(i / 3)]
    const cx = x + w / 2
    return `
  <rect x="${x}" y="${y}" width="${w}" height="${ROW_H}" fill="${m.colorHex}"/>
  <text x="${cx}" y="${y + 305}" text-anchor="middle"
    font-family="'Noto Sans Thai',sans-serif"
    font-size="120" font-weight="700" fill="#2D2218">${m.name}</text>
  <text x="${cx}" y="${y + 415}" text-anchor="middle"
    font-family="'Noto Sans Thai',sans-serif"
    font-size="78" fill="#2D2218" opacity="0.7">${m.year}</text>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 2500 1686" xmlns="http://www.w3.org/2000/svg">
  ${cells}
  <line x1="833"  y1="0" x2="833"  y2="${BACK_Y}" stroke="#FFFFFF" stroke-width="8"/>
  <line x1="1667" y1="0" x2="1667" y2="${BACK_Y}" stroke="#FFFFFF" stroke-width="8"/>
  <line x1="0" y1="${ROW_H}" x2="2500" y2="${ROW_H}" stroke="#FFFFFF" stroke-width="8"/>
  <rect x="0" y="${BACK_Y}" width="2500" height="${BACK_H}" fill="#4B3D33"/>
  <g transform="translate(420,${BACK_Y + BACK_H / 2})" fill="none" stroke="#FFFFFF"
     stroke-width="16" stroke-linecap="round" stroke-linejoin="round">
    <line x1="62" y1="0" x2="-62" y2="0"/>
    <polyline points="-8,-54 -62,0 -8,54"/>
  </g>
  <text x="1310" y="${BACK_Y + BACK_H / 2 + 38}" text-anchor="middle"
    font-family="'Noto Sans Thai',sans-serif"
    font-size="100" font-weight="700" fill="#FFFFFF">กลับไปเมนูหลัก</text>
</svg>`
}

// ── Build rich menu JSON payload (2500 × 1686) ───────────────────────────────
export function buildMenuPayload(months) {
  const monthAreas = months.map((m, i) => ({
    bounds: {
      x:      COLS[i % 3].x,
      y:      ROWS[Math.floor(i / 3)].y,
      width:  COLS[i % 3].w,
      height: ROW_H,
    },
    action: {
      type: 'uri',
      uri:  `https://liff.line.me/2008561527-a0xP1XmY?sheetname=${m.sheet}&color=${m.colorTw}`,
    },
  }))
  return {
    size:        { width: 2500, height: 1686 },
    selected:    true,
    name:        'Month Picker',
    chatBarText: 'เลือกเดือน',
    areas: [
      ...monthAreas,
      {
        bounds: { x: 0, y: BACK_Y, width: 2500, height: BACK_H },
        action: { type: 'richmenuswitch', richMenuAliasId: 'status', data: 'back_to_main' },
      },
    ],
  }
}

// ── Set alias (create or delete-then-create) ──────────────────────────────────
export async function setAlias(aliasId, richMenuId) {
  try {
    await axios.post(`${API}/v2/bot/richmenu/alias`,
      { richMenuAliasId: aliasId, richMenuId }, { headers: jsonHdr })
    ok(`Alias "${aliasId}" created`)
  } catch {
    await axios.delete(`${API}/v2/bot/richmenu/alias/${aliasId}`, { headers: authHdr })
    await axios.post(`${API}/v2/bot/richmenu/alias`,
      { richMenuAliasId: aliasId, richMenuId }, { headers: jsonHdr })
    ok(`Alias "${aliasId}" updated`)
  }
}

// ── Create + upload a rich menu, return its richMenuId ────────────────────────
export async function createAndUpload(payload, pngBuffer) {
  const { data: { richMenuId } } = await axios.post(
    `${API}/v2/bot/richmenu`, payload, { headers: jsonHdr }
  )
  await axios.post(
    `${DATA_API}/v2/bot/richmenu/${richMenuId}/content`,
    pngBuffer,
    { headers: { ...authHdr, 'Content-Type': 'image/png' }, maxBodyLength: Infinity }
  )
  return richMenuId
}

// ── Main (only runs when called directly, not when imported) ─────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {

  if (!TOKEN) { console.error('Missing LINE_TOKEN env var'); process.exit(1) }

  let oldId = null
  try {
    const res = await axios.get(`${API}/v2/bot/richmenu/alias/month-picker`, { headers: authHdr })
    oldId = res.data.richMenuId
    log(`Existing month-picker: ${oldId}`)
  } catch {
    log('No existing month-picker alias — will create fresh')
  }

  const months = getMonthData()
  log(`Month range: ${months.map(m => `${m.name} ${m.year}`).join(' → ')}`)

  log('Rendering SVG → PNG...')
  const pngBuffer = svgToPng(generateSVG(months))
  ok(`PNG ready — ${(pngBuffer.length / 1024).toFixed(1)} KB`)

  log('Creating rich menu...')
  const richMenuId = await createAndUpload(buildMenuPayload(months), pngBuffer)
  ok(`Month-picker created — ${richMenuId}`)

  await setAlias('month-picker', richMenuId)

  if (oldId && oldId !== richMenuId) {
    try {
      await axios.delete(`${API}/v2/bot/richmenu/${oldId}`, { headers: authHdr })
      ok(`Deleted old rich menu ${oldId}`)
    } catch (e) {
      log(`⚠  Could not delete old rich menu: ${e.response?.data?.message ?? e.message}`)
    }
  }

  log('\n─────────────────────────────────────')
  log(`  alias     : month-picker`)
  log(`  richMenuId: ${richMenuId}`)
  log(`  months    : ${months.map(m => m.name).join(', ')}`)
  log('─────────────────────────────────────')
} // end direct-run guard
