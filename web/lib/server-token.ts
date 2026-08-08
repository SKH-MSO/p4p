import { headers } from "next/headers"
import { redirect } from "next/navigation"

/** Must match the header middleware.ts sets. */
export const TOKEN_HEADER = "x-p4p-access-token"
export const NONCE_HEADER = "x-nonce"

/**
 * The access token for this request, resolved by middleware.
 *
 * This replaces the `<meta name="p4p-session" content="__P4P_ACCESS_TOKEN__">`
 * placeholder the Express app string-replaced into each page. Passing it
 * through a request header means there is no sentinel that can leak
 * un-replaced, and no HTML read from disk at module load.
 *
 * Fail-safe: middleware should already have redirected an unauthenticated
 * request, so reaching here without a token means something is wrong with the
 * matcher. Redirect rather than render a broken page.
 */
export async function requireAccessToken(returnTo: string): Promise<string> {
  const token = (await headers()).get(TOKEN_HEADER)
  if (!token) {
    redirect(`/verify/?return=${encodeURIComponent(returnTo)}&reason=no_session`)
  }
  return token
}

/** The per-request CSP nonce, for any inline script a page genuinely needs. */
export async function cspNonce(): Promise<string | undefined> {
  return (await headers()).get(NONCE_HEADER) ?? undefined
}
