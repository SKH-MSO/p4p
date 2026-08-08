"use client"

import { useEffect, useState } from "react"

/**
 * The full-screen "not supported here" block.
 *
 * Every page has its own copy of this today, with the same two-branch wording:
 * a desktop visitor is told to use a phone, a mobile visitor outside LINE is
 * told to open it through LINE. The check runs client-side because it reads the
 * user agent, and it renders nothing at all until it has — so a LINE user never
 * sees a flash of the block.
 *
 * `requireLine` is false for /admin/, which is the one page that legitimately
 * runs in a plain mobile browser.
 */
export type BlockState = "checking" | "allowed" | "desktop" | "not-line"

export function useDeviceGate(requireLine = true): BlockState {
  const [state, setState] = useState<BlockState>("checking")

  useEffect(() => {
    const ua = navigator.userAgent
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua)
    const inLine = /Line\//i.test(ua)

    if (!isMobile) setState("desktop")
    else if (requireLine && !inLine) setState("not-line")
    else setState("allowed")
  }, [requireLine])

  return state
}

export default function DesktopBlock({ state }: { state: BlockState }) {
  if (state === "allowed" || state === "checking") return null

  const [heading, body] =
    state === "desktop"
      ? ["ไม่รองรับการใช้งานบนคอมพิวเตอร์", "กรุณาเปิดลิงก์นี้ผ่านโทรศัพท์มือถือ"]
      : ["กรุณาเปิดผ่าน LINE application", "ขอบคุณสำหรับความร่วมมือ"]

  return (
    <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-[var(--color-neutral)] px-8 text-center">
      <h2 className="font-[family-name:var(--font-manrope)] text-[1.4rem] font-bold text-[var(--color-secondary)]">
        {heading}
      </h2>
      <p className="mt-2 text-base text-[var(--color-muted)]">{body}</p>
    </div>
  )
}
