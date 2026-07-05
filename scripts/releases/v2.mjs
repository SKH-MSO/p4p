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
  <circle cx="36" cy="34" r="5" fill="#2D6CDF" opacity=".22"/><circle cx="240" cy="36" r="7" fill="#2D6CDF" opacity=".15"/><circle cx="232" cy="138" r="4" fill="#2D6CDF" opacity=".25"/>

  <!-- app-screen mockup: 3 verification steps, all checked -->
  <rect x="78" y="30" width="116" height="118" rx="14" fill="#fff" stroke="#CDE1FB" stroke-width="2"/>
  <rect x="108" y="23" width="56" height="16" rx="8" fill="#2D6CDF"/>
  <circle cx="100" cy="64" r="9" fill="#2D6CDF"/><path d="M96 64 l3 3 l5 -6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="116" y="60" width="62" height="8" rx="4" fill="#D8DCE0"/>
  <circle cx="100" cy="92" r="9" fill="#2D6CDF"/><path d="M96 92 l3 3 l5 -6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="116" y="88" width="50" height="8" rx="4" fill="#D8DCE0"/>
  <circle cx="100" cy="120" r="9" fill="#2D6CDF"/><path d="M96 120 l3 3 l5 -6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="116" y="116" width="44" height="8" rx="4" fill="#D8DCE0"/>

  <!-- verified result: shield + check -->
  <circle cx="182" cy="118" r="25" fill="#fff" stroke="#2D6CDF" stroke-width="6"/><circle cx="182" cy="118" r="13" fill="#EAF2FF"/><path d="M175 118 l5 5 l10 -12" fill="none" stroke="#0B3FA6" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- corner badge: lock (privacy) -->
  <rect x="34" y="58" width="42" height="40" rx="8" fill="#fff" stroke="#CDE1FB" stroke-width="2"/><rect x="34" y="58" width="42" height="13" rx="6" fill="#2D6CDF"/>
  <path d="M49,80 v-5 a6,6 0 0 1 12,0 v5" fill="none" stroke="#2D6CDF" stroke-width="2.5" stroke-linecap="round"/>
  <rect x="46" y="80" width="18" height="14" rx="3" fill="#2D6CDF"/>
  <circle cx="55" cy="86" r="1.8" fill="#fff"/>

  <!-- "ใหม่" badge -->
  <g transform="rotate(-10 232 44)">
    <rect x="210" y="30" width="44" height="27" rx="13.5" fill="#FFC400"/>
    <text x="232" y="49" text-anchor="middle" font-family="'Noto Sans Thai',sans-serif" font-size="15" font-weight="700" fill="#333">ใหม่</text>
  </g>
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
      { type: 'text', text: 'ฟีเจอร์ใหม่', size: 'xs', weight: 'bold', color: '#0B3FA6' },
      { type: 'text', text: 'ยืนยันตัวตนก่อนเข้าใช้งาน', size: 'lg', weight: 'bold', color: '#1F2937', margin: 'sm', wrap: true },
      { type: 'box', layout: 'vertical', contents: [], width: '34px', height: '3px', backgroundColor: '#2D6CDF', cornerRadius: '2px', margin: 'md' },
      bulletRow('ยืนยันตัวตนด้วยอีเมล พร้อมรหัส OTP 6 หลัก'),
      bulletRow('ผูกบัญชี LINE อัตโนมัติ เข้าใช้งานได้ทันทีในครั้งถัดไป'),
      bulletRow('การยืนยันตัวตนช่วยเพิ่มความปลอดภัย และปกป้องความเป็นส่วนตัวของข้อมูลท่าน'),
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
