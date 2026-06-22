import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fontDir = join(__dirname, '../src/fonts')

// Loaded once. resvg matches font-family against these buffers and shapes
// Thai (combining vowels/tone marks) correctly via its HarfBuzz port.
const fontBuffers = [
  readFileSync(join(fontDir, 'NotoSansThai-Regular.ttf')),
  readFileSync(join(fontDir, 'NotoSansThai-Bold.ttf')),
]

// Render an SVG string to a PNG Buffer at the given width (height follows viewBox).
// NOTE: resvg-js 2.6.2 ignores `fitTo` when custom fontBuffers are supplied, so we
// set the output size by writing explicit width/height onto the root <svg>; the
// viewBox keeps the original coordinate system.
export function svgToPng(svg, width = 2500) {
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  if (vb) {
    const height = Math.round((width * Number(vb[2])) / Number(vb[1]))
    svg = svg.replace('<svg ', `<svg width="${width}" height="${height}" `)
  }
  const resvg = new Resvg(svg, {
    background: 'rgba(255,255,255,0)',
    font: {
      fontBuffers,
      defaultFontFamily: 'Noto Sans Thai',
      loadSystemFonts: false,
    },
  })
  return resvg.render().asPng()
}
