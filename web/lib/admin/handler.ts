import { NextResponse } from "next/server"
import { isAdminRequest } from "./tokens"
import { AdminError } from "./roster"

/**
 * Wraps an /admin/api/* handler with the auth check and error mapping.
 *
 * Every route this wraps holds the service-role key, so the 401 path is the
 * only thing between an unauthenticated request and an RLS-bypassing write.
 * Centralised here so a new route cannot forget it — adding a route without
 * `withAdmin` should look obviously wrong in review.
 */
export function withAdmin<Ctx>(
  handler: (request: Request, context: Ctx) => Promise<NextResponse>,
): (request: Request, context: Ctx) => Promise<NextResponse> {
  return async (request, context) => {
    if (!isAdminRequest(request)) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 })
    }
    try {
      return await handler(request, context)
    } catch (err) {
      if (err instanceof AdminError) {
        if (err.status === 404) return NextResponse.json({ error: "unknown table" }, { status: 404 })
        console.error("[admin]", err.message)
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      console.error("[admin] unexpected failure:", err)
      return NextResponse.json({ error: "request failed" }, { status: 500 })
    }
  }
}

/** Route params arrive as a Promise in the App Router. */
export type RouteContext<T> = { params: Promise<T> }
