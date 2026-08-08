import { requireAccessToken } from "@/lib/server-token"
import { rankingMonths } from "@/lib/months"
import RankingClient from "./RankingClient"

/** Who submitted on time, in submission order, per month. */
export const dynamic = "force-dynamic"

export const metadata = { title: "การจัดอันดับ — SAKHONMSO P4P" }

export default async function RankingPage() {
  const accessToken = await requireAccessToken("/ranking/")
  return <RankingClient accessToken={accessToken} months={rankingMonths()} />
}
