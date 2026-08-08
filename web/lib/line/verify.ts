import { serverEnv } from "../config"

/**
 * Ask LINE whether a LIFF ID token is genuine. LINE checks the signature,
 * expiry and audience for us and returns the claims; `sub` is the
 * authoritative LINE userId.
 *
 * This is the whole point of the second factor. liff.getProfile().userId is
 * just a string the browser chooses to send — the old bind RPC took it as a
 * parameter and believed it. An ID token cannot be forged by the page.
 */
export interface VerifiedLineIdentity {
  sub: string
  name: string | null
}

export async function verifyLineIdToken(
  idToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedLineIdentity | null> {
  const clientId = serverEnv.lineLoginChannelId()
  if (!clientId) {
    console.error("[line-bind] LINE_LOGIN_CHANNEL_ID is not set — cannot verify ID tokens")
    return null
  }

  try {
    const response = await fetchImpl("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }).toString(),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      console.error("[line-bind] LINE rejected the id_token:", response.status)
      return null
    }
    const data = (await response.json()) as { sub?: string; name?: string }
    if (!data.sub) {
      console.error("[line-bind] LINE verify returned no sub claim")
      return null
    }
    return { sub: data.sub, name: data.name ?? null }
  } catch (err) {
    console.error("[line-bind] LINE verify request failed:", err)
    return null
  }
}
