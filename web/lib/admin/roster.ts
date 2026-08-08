import { SUPABASE_URL, serverEnv } from "../config"

/**
 * Service-role access to the monthly roster tables, for the admin dashboard.
 *
 * Everything here holds SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS. None of
 * it may be imported from a client component — the browser only ever talks to
 * the /admin/api/* routes that wrap these.
 */

export interface RosterColumn {
  column_name: string
  data_type: string
  is_pk: boolean
}

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function serviceHeaders(): Record<string, string> {
  const key = serverEnv.supabaseServiceRoleKey()
  if (!key) throw new AdminError("SUPABASE_SERVICE_ROLE_KEY is not set", 500)
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  }
}

/**
 * PostgREST error bodies are {message, details, hint, code}. Surfaced back to
 * the browser as-is: this is a single-admin internal tool, so a raw constraint
 * message ("null value in column \"prefix\" violates not-null constraint") is
 * far more useful than a generic "insert failed", and there is no other caller
 * to leak it to.
 */
async function pgError(response: Response, fallback: string): Promise<AdminError> {
  try {
    const body = (await response.json()) as { message?: string }
    return new AdminError(body?.message ?? fallback, response.status === 404 ? 404 : 400)
  } catch {
    return new AdminError(fallback, 400)
  }
}

export async function callServiceRpc<T>(fn: string, args: unknown = {}): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw await pgError(response, `${fn} failed`)
  return (await response.json()) as T
}

export function listRosterTables(): Promise<string[]> {
  return callServiceRpc<string[]>("admin_list_roster_tables")
}

export function tableColumns(table: string): Promise<RosterColumn[]> {
  return callServiceRpc<RosterColumn[]>("admin_table_columns", { p_table: table })
}

/**
 * Re-fetches the live roster-table list and checks membership — never trust a
 * :table path param on its own, since it selects which Postgres table the next
 * request reads or writes.
 */
export async function assertRosterTable(table: string): Promise<void> {
  const tables = await listRosterTables()
  if (!Array.isArray(tables) || !tables.includes(table)) {
    throw new AdminError(`unknown roster table: ${table}`, 404)
  }
}

/**
 * Keep only keys that are real, non-PK columns of the target table.
 *
 * The request body is client-controlled, so together with assertRosterTable
 * this is the entire boundary between a browser and a service-role write. It
 * stops an insert/update writing to a column that does not exist and stops the
 * primary key being overwritten.
 */
export function filterToColumns(
  columns: readonly RosterColumn[],
  body: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const allowed = new Set(columns.filter((c) => !c.is_pk).map((c) => c.column_name))
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(body ?? {})) {
    if (allowed.has(key)) out[key] = body![key]
  }
  return out
}

export async function fetchRows(table: string): Promise<unknown[]> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?select=*&order=department,lastname`,
    { headers: serviceHeaders(), signal: AbortSignal.timeout(8000) },
  )
  if (!response.ok) throw await pgError(response, "failed to load rows")
  return (await response.json()) as unknown[]
}

export async function insertRow(
  table: string,
  body: Record<string, unknown>,
): Promise<unknown | null> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}`, {
    method: "POST",
    headers: { ...serviceHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw await pgError(response, "insert failed")
  const rows = (await response.json()) as unknown[]
  return rows?.[0] ?? null
}

export async function updateRow(
  table: string,
  index: string,
  body: Record<string, unknown>,
): Promise<unknown | null> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?index=eq.${encodeURIComponent(index)}`,
    {
      method: "PATCH",
      headers: { ...serviceHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    },
  )
  if (!response.ok) throw await pgError(response, "update failed")
  const rows = (await response.json()) as unknown[]
  return rows?.[0] ?? null
}

export async function deleteRow(table: string, index: string): Promise<void> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?index=eq.${encodeURIComponent(index)}`,
    { method: "DELETE", headers: serviceHeaders(), signal: AbortSignal.timeout(8000) },
  )
  if (!response.ok) throw await pgError(response, "delete failed")
}
