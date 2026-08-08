"use client"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config"

/**
 * The data client for the physician pages, authenticated with the access token
 * the server resolved for this request and passed down as a prop.
 *
 * No client-side session: `accessToken` is the supported way to bring your own
 * token, and supabase-js sends it as `Authorization: Bearer <token>` on every
 * request. RLS enforces the allow-list from there. Nothing is persisted,
 * because LINE's in-app webview does not persist a session reliably — that is
 * the reason the whole server-side gate exists.
 */
const cache = new Map<string, SupabaseClient>()

export function supabaseWithToken(accessToken: string): SupabaseClient {
  const existing = cache.get(accessToken)
  if (existing) return existing

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    accessToken: () => Promise.resolve(accessToken),
  })
  cache.set(accessToken, client)
  return client
}

/** Rows every page reads out of a monthly roster table. */
export interface RosterRow {
  firstname: string | null
  lastname: string | null
  department: string | null
  submitted_at?: string | null
}

/**
 * PostgREST reports a missing table as 42P01. The current month's table may not
 * exist until provision_month() runs, and that should read as "nobody has sent
 * yet", not as an error. Prefer the structured code over matching the message
 * text, which is a wording change away from breaking.
 */
export function isMissingTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  return e?.code === "42P01" || /does not exist|undefined_table|schema cache/i.test(e?.message ?? "")
}
