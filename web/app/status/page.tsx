import { requireAccessToken } from "@/lib/server-token"
import { isMonthKey } from "@/lib/months"
import StatusClient from "./StatusClient"

/**
 * Per-month roster: who has submitted and who has not.
 *
 * Reached from the LINE Flex month picker as /status/?sheetname=YYYY_MM.
 * Dynamic because the access token is per-request.
 */
export const dynamic = "force-dynamic"

export const metadata = { title: "สถานะการส่ง — SAKHONMSO P4P" }

export default async function StatusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const accessToken = await requireAccessToken("/status/")

  // LIFF often nests an already percent-encoded querystring inside liff.state
  // (e.g. "?liff.state=%3Fsheetname%3D2569_07"). Next has already parsed the
  // query, so handle both shapes.
  let sheetname = firstValue(params.sheetname)
  if (!sheetname) {
    const nested = firstValue(params["liff.state"])
    if (nested) {
      try {
        sheetname = new URLSearchParams(decodeURIComponent(nested).replace(/^\?/, "")).get(
          "sheetname",
        )
      } catch {
        // A stray "%" that is not a valid escape makes decodeURIComponent throw.
        // In the legacy page this ran at module top level and left the page
        // stuck on its loading skeleton forever with no visible error.
        sheetname = null
      }
    }
  }

  // The legacy page passed this straight into db.from() with no validation.
  return <StatusClient accessToken={accessToken} monthKey={isMonthKey(sheetname) ? sheetname : null} />
}

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}
