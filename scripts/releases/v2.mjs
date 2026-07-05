export const RELEASE  = 'v2'
export const BASE_URL = 'https://skh-mso-p4p.vercel.app/assets/cards/v2'
export const ALT_TEXT = 'อัปเดตใหม่ — ยืนยันตัวตนด้วยอีเมลและ LINE เพื่อความปลอดภัยและความเป็นส่วนตัว'

const LIFF_VERIFY_URL = 'https://liff.line.me/2008561527-AShTrJz0'

// SVG strings + render widths. Height is derived from viewBox aspect ratio.
export const svgs = [
  {
    file: 'identity.png',
    width: 1536,  // → 1536×967 (20:13, matches the flex hero aspectRatio below)
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 170">
  <rect width="270" height="170" fill="#EAF2FF"/>
  <circle cx="34" cy="32" r="5" fill="#2D6CDF" opacity=".18"/>
  <circle cx="240" cy="34" r="7" fill="#2D6CDF" opacity=".14"/>
  <circle cx="230" cy="140" r="4" fill="#FFC400" opacity=".4"/>
  <circle cx="26" cy="132" r="4" fill="#2D6CDF" opacity=".2"/>

  <!-- envelope (email verification) -->
  <rect x="30" y="66" width="56" height="42" rx="8" fill="#fff" stroke="#BBD3FA" stroke-width="2"/>
  <path d="M30 70 L58 92 L86 70" fill="none" stroke="#2D6CDF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- dashed links into the shield -->
  <line x1="86" y1="88" x2="104" y2="88" stroke="#9CBEF6" stroke-width="3" stroke-dasharray="4 4" stroke-linecap="round"/>
  <line x1="166" y1="88" x2="184" y2="88" stroke="#9CBEF6" stroke-width="3" stroke-dasharray="4 4" stroke-linecap="round"/>

  <!-- shield (verified identity) -->
  <path d="M135,42 L166,53 L166,94 C166,120 152,133 135,140 C118,133 104,120 104,94 L104,53 Z" fill="#2D6CDF" stroke="#0B3FA6" stroke-width="2"/>
  <path d="M120,91 l10,10 l21,-25" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- chat bubble (LINE binding) -->
  <rect x="184" y="66" width="56" height="40" rx="10" fill="#fff" stroke="#BBD3FA" stroke-width="2"/>
  <path d="M198 106 L198 118 L212 106 Z" fill="#fff" stroke="#BBD3FA" stroke-width="2"/>
  <rect x="194" y="78" width="36" height="6" rx="3" fill="#2D6CDF" opacity=".75"/>
  <rect x="194" y="90" width="24" height="6" rx="3" fill="#9CBEF6"/>

  <!-- "ใหม่" badge -->
  <g transform="rotate(-10 224 34)">
    <rect x="202" y="20" width="44" height="27" rx="13.5" fill="#FFC400"/>
    <text x="224" y="39" text-anchor="middle" font-family="'Noto Sans Thai',sans-serif" font-size="15" font-weight="700" fill="#333">ใหม่</text>
  </g>

  <text x="135" y="160" text-anchor="middle" font-family="'Noto Sans Thai',sans-serif" font-size="13.5" font-weight="700" fill="#0B3FA6">ยืนยันตัวตนอีเมล + LINE</text>
</svg>`,
  },
]

const bulletRow = (text) => ({
  type: 'box', layout: 'baseline', spacing: 'sm', margin: 'md',
  contents: [
    { type: 'text', text: '•', size: 'sm', color: '#2D6CDF', weight: 'bold', flex: 0 },
    { type: 'text', text, size: 'sm', color: '#555555', wrap: true, flex: 1 },
  ],
})

// Single bubble (no carousel wrapper) announcing identity verification via
// email OTP + LINE account binding.
export const bubble = {
  type: 'bubble',
  size: 'mega',
  hero: {
    type: 'image',
    url: `${BASE_URL}/identity.png`,
    size: 'full',
    aspectRatio: '20:13',
    aspectMode: 'cover',
  },
  body: {
    type: 'box',
    layout: 'vertical',
    paddingAll: '20px',
    backgroundColor: '#FFFFFF',
    contents: [
      { type: 'text', text: 'อัปเดตใหม่', size: 'xs', weight: 'bold', color: '#0B3FA6' },
      { type: 'text', text: 'ยืนยันตัวตนก่อนเข้าใช้งาน', size: 'lg', weight: 'bold', color: '#1F2937', margin: 'sm', wrap: true },
      { type: 'box', layout: 'vertical', contents: [], width: '34px', height: '3px', backgroundColor: '#2D6CDF', cornerRadius: '2px', margin: 'md' },
      bulletRow('ยืนยันตัวตนด้วยอีเมล พร้อมรหัส OTP 6 หลัก'),
      bulletRow('ผูกบัญชี LINE อัตโนมัติ เข้าใช้งานได้ทันทีในครั้งถัดไป'),
      bulletRow('เพื่อความปลอดภัยและความเป็นส่วนตัวของข้อมูลท่าน'),
      { type: 'text', text: 'ทำเพียงครั้งเดียวเท่านั้น', size: 'xs', color: '#8A94A6', margin: 'lg' },
    ],
  },
  footer: {
    type: 'box',
    layout: 'vertical',
    paddingAll: '16px',
    paddingTop: '0px',
    backgroundColor: '#FFFFFF',
    contents: [
      {
        type: 'button',
        style: 'primary',
        color: '#2D6CDF',
        height: 'sm',
        action: { type: 'uri', label: 'ยืนยันตัวตนตอนนี้', uri: LIFF_VERIFY_URL },
      },
    ],
  },
  styles: {
    footer: { separator: true, separatorColor: '#EAF2FF' },
  },
}
