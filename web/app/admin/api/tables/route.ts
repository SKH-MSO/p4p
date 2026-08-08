import { NextResponse } from "next/server"
import { withAdmin } from "@/lib/admin/handler"
import { listRosterTables } from "@/lib/admin/roster"

export const runtime = "nodejs"

export const GET = withAdmin(async () => {
  const tables = await listRosterTables()
  return NextResponse.json({ tables: tables ?? [] })
})
