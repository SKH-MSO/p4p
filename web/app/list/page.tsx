import { requireAccessToken } from "@/lib/server-token"
import { recentMonthKeys } from "@/lib/months"
import ListClient from "./ListClient"

/** Browsable physician roster: pick a month, search, sort, page through it. */
export const dynamic = "force-dynamic"

export const metadata = { title: "รายชื่อแพทย์ — SAKHONMSO P4P" }

export default async function ListPage() {
  const accessToken = await requireAccessToken("/list/")
  // Computed on the server so the dropdown is populated in the first paint
  // rather than after hydration.
  return <ListClient accessToken={accessToken} months={recentMonthKeys(6)} />
}
