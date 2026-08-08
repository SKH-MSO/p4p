import { NextResponse } from "next/server"
import { withAdmin, type RouteContext } from "@/lib/admin/handler"
import { assertRosterTable, deleteRow, filterToColumns, tableColumns, updateRow } from "@/lib/admin/roster"

export const runtime = "nodejs"

type Ctx = RouteContext<{ table: string; index: string }>

export const PATCH = withAdmin(async (request, { params }: Ctx) => {
  const { table, index } = await params
  await assertRosterTable(table)

  let raw: Record<string, unknown>
  try {
    raw = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 })
  }

  const body = filterToColumns(await tableColumns(table), raw)
  return NextResponse.json({ row: await updateRow(table, index, body) })
})

export const DELETE = withAdmin(async (_request, { params }: Ctx) => {
  const { table, index } = await params
  await assertRosterTable(table)
  await deleteRow(table, index)
  return NextResponse.json({ ok: true })
})
