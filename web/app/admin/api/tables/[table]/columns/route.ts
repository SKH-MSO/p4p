import { NextResponse } from "next/server"
import { withAdmin, type RouteContext } from "@/lib/admin/handler"
import { assertRosterTable, tableColumns } from "@/lib/admin/roster"

export const runtime = "nodejs"

export const GET = withAdmin(async (_request, { params }: RouteContext<{ table: string }>) => {
  const { table } = await params
  await assertRosterTable(table)
  const columns = await tableColumns(table)
  return NextResponse.json({ columns: columns ?? [] })
})
