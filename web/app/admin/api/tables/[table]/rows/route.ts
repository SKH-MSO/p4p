import { NextResponse } from "next/server"
import { withAdmin, type RouteContext } from "@/lib/admin/handler"
import { assertRosterTable, fetchRows, filterToColumns, insertRow, tableColumns } from "@/lib/admin/roster"

export const runtime = "nodejs"

type Ctx = RouteContext<{ table: string }>

export const GET = withAdmin(async (_request, { params }: Ctx) => {
  const { table } = await params
  await assertRosterTable(table)
  return NextResponse.json({ rows: await fetchRows(table) })
})

export const POST = withAdmin(async (request, { params }: Ctx) => {
  const { table } = await params
  await assertRosterTable(table)

  let raw: Record<string, unknown>
  try {
    raw = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 })
  }

  const body = filterToColumns(await tableColumns(table), raw)
  return NextResponse.json({ row: await insertRow(table, body) })
})
