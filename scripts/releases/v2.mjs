export const RELEASE  = 'v2'
export const BASE_URL = 'https://skh-mso-p4p.vercel.app/assets/cards/v2'
export const ALT_TEXT = 'อัปเดตใหม่ — ยืนยันตัวตนด้วยอีเมลและ LINE เพื่อความปลอดภัยและความเป็นส่วนตัว'

const LIFF_VERIFY_URL = 'https://liff.line.me/2008561527-AShTrJz0'

// SVG strings + render widths. Height is derived from viewBox aspect ratio.
export const svgs = [
  {
    file: 'front.png',
    width: 1080,  // → 1080×1520 (270:380, cropped to the 3:4 hero enum)
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 380">
  <defs><path id="st" d="M0,-6 L1.4,-1.4 L6,0 L1.4,1.4 L0,6 L-1.4,1.4 L-6,0 L-1.4,-1.4 Z"/></defs>
  <rect width="270" height="380" fill="#EAF2FF"/>
  <use href="#st" transform="translate(36,50) scale(1.5)" fill="#FFC400"/>
  <use href="#st" transform="translate(234,44) scale(1.0)" fill="#2D6CDF" opacity=".45"/>
  <use href="#st" transform="translate(250,150) scale(.9)" fill="#FFC400" opacity=".8"/>
  <use href="#st" transform="translate(22,140) scale(1.0)" fill="#2D6CDF" opacity=".4"/>
  <use href="#st" transform="translate(246,232) scale(.9)" fill="#FFC400" opacity=".7"/>
  <use href="#st" transform="translate(26,250) scale(1.4)" fill="#FFC400" opacity=".55"/>
  <use href="#st" transform="translate(250,318) scale(1.0)" fill="#2D6CDF" opacity=".4"/>
  <use href="#st" transform="translate(40,352) scale(1.1)" fill="#FFC400" opacity=".75"/>
  <use href="#st" transform="translate(236,360) scale(1.4)" fill="#FFC400" opacity=".6"/>
  <use href="#st" transform="translate(210,300) scale(.8)" fill="#2D6CDF" opacity=".4"/>
  <use href="#st" transform="translate(60,305) scale(.7)" fill="#FFC400" opacity=".5"/>
  <use href="#st" transform="translate(135,16) scale(.8)" fill="#2D6CDF" opacity=".4"/>

  <!-- phone mockup: email → OTP/lock → LINE, stacked -->
  <rect x="103" y="30" width="64" height="124" rx="15" fill="#fff" stroke="#2D6CDF" stroke-width="3"/>
  <rect x="126" y="36" width="18" height="3.5" rx="1.75" fill="#CDE1FB"/>
  <rect x="110" y="46" width="50" height="92" rx="7" fill="#F0F6FF"/>

  <rect x="116" y="52" width="38" height="24" rx="6" fill="#2D6CDF"/>
  <rect x="122" y="57" width="26" height="16" rx="2" fill="none" stroke="#fff" stroke-width="2"/>
  <path d="M122 59 L135 69 L148 59" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>

  <rect x="116" y="80" width="38" height="24" rx="6" fill="#4B84E8"/>
  <path d="M129,90 v-4 a6,6 0 0 1 12,0 v4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
  <rect x="127" y="90" width="16" height="11" rx="2" fill="#fff"/>
  <circle cx="135" cy="95.5" r="1.4" fill="#4B84E8"/>

  <rect x="116" y="108" width="38" height="24" rx="6" fill="#8FB8FA"/>
  <rect x="122" y="113" width="26" height="14" rx="4" fill="none" stroke="#fff" stroke-width="2"/>
  <path d="M128 127 L128 132 L134 127 Z" fill="#fff"/>

  <rect x="124" y="142" width="22" height="3.5" rx="1.75" fill="#CDE1FB"/>

  <g transform="rotate(-12 192 50)">
    <rect x="170" y="36" width="44" height="28" rx="14" fill="#FFC400"/>
    <text x="192" y="55" text-anchor="middle" font-family="'Noto Sans Thai',sans-serif" font-size="15" font-weight="700" fill="#333">ใหม่</text>
  </g>
  <rect x="87" y="206" width="96" height="27" rx="13.5" fill="#2D6CDF"/>
  <text x="135" y="224.5" text-anchor="middle" font-family="'Noto Sans Thai',sans-serif" font-size="14" font-weight="700" fill="#fff">อัปเดตใหม่</text>
  <text x="135" y="272" text-anchor="middle" font-family="'Noto Sans Thai',sans-serif" font-size="26" font-weight="700" fill="#12224A">ยืนยันตัวตน</text>
  <rect x="115" y="285" width="40" height="3.5" rx="1.75" fill="#2D6CDF"/>
  <text x="135" y="312" text-anchor="middle" font-family="'Noto Sans Thai',sans-serif" font-size="13.5" fill="#555">ปลอดภัย · เป็นส่วนตัว</text>
  <text x="135" y="331" text-anchor="middle" font-family="'Noto Sans Thai',sans-serif" font-size="13.5" fill="#555">ยืนยันด้วยอีเมลและ LINE</text>
  <text x="120" y="360" text-anchor="middle" font-family="'Noto Sans Thai',sans-serif" font-size="13" font-weight="700" fill="#0B3FA6">เลื่อนดูทางขวา</text>
  <g stroke="#0B3FA6" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <line x1="183" y1="356" x2="197" y2="356"/><polyline points="192,351 197,356 192,361"/>
  </g>
</svg>`,
  },
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

// Bubble 1 — front: hero-only cover, matching v1's cover.png (image fills the
// whole bubble, swipe hint included since this is now a real 2-bubble carousel).
const frontBubble = {
  type: 'bubble',
  size: 'mega',
  hero: {
    type: 'image',
    url: `${BASE_URL}/front.png`,
    size: 'full',
    aspectRatio: '3:4',
    aspectMode: 'cover',
  },
}

// Bubble 2 — content: the checklist mockup + copy explaining the flow, matching
// v1 bubble-2's label/title/divider/bullets format.
const contentBubble = {
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

export const bubbles = [frontBubble, contentBubble]
