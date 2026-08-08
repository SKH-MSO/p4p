/**
 * Deployment configuration.
 *
 * The Supabase URL and publishable key are hardcoded in main.js and
 * assets/shared.js today. They are not secrets — the publishable key is meant
 * to be in page source, and the data behind it is protected by RLS — so they
 * keep the same defaults here, with env overrides so a preview deployment can
 * be pointed elsewhere without a code change.
 *
 * Everything that IS a secret is read from the environment with no default and
 * must never be imported into a client component.
 */

export const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://zjeizbrzcltkgtlmkbji.supabase.co"

export const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? "sb_publishable_TcCSpznim4fi0Y7E_zuAsg_op19VZQ-"

/** Cookie holding {at, rt} for the physician session. */
export const SESSION_COOKIE = "p4p_rt"

/** Redirect-loop backstop counter (see lib/gate/loop.ts). */
export const BIND_LOOP_COOKIE = "p4p_bindloop"

/** Admin dashboard session cookie. */
export const ADMIN_COOKIE = "p4p_admin"

/** Shared cookie attributes. Path=/ so one cookie covers every route. */
export const COOKIE_BASE = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const

/**
 * Staged rollout switch for the LINE second factor.
 *
 *   unset/false — DETECT ONLY. A bind is still verified against LINE and a
 *                 mismatch refused, but page access keeps the existing rules
 *                 including the "3 failures then let them through" fail-open.
 *   "true"      — ENFORCE. A gated page requires that THIS SESSION proved its
 *                 LINE identity, and the fail-opens are switched off.
 *
 * Read as a function, not a module constant, so tests can flip it.
 */
export function lineBindEnforce(): boolean {
  return process.env.LINE_BIND_ENFORCE === "true"
}

/** Three failed binds, then the user is let through with an admin alert. */
export const BIND_ATTEMPT_LIMIT = 3

/**
 * Hard cap on consecutive bind_required redirects for one browser, independent
 * of anything the database or the client reports. One above the intended 3 real
 * attempts, as slack.
 */
export const BIND_LOOP_MAX = 4

/** Server-only secrets. Throwing here would break the whole app at import
 *  time, so these return undefined and each caller decides what that means. */
export const serverEnv = {
  lineAccessToken: () => process.env.LINE_ACCESS_TOKEN,
  lineChannelSecret: () => process.env.LINE_CHANNEL_SECRET,
  lineLoginChannelId: () => process.env.LINE_LOGIN_CHANNEL_ID,
  supabaseServiceRoleKey: () => process.env.SUPABASE_SERVICE_ROLE_KEY,
  telegramBotToken: () => process.env.TELEGRAM_BOT_TOKEN,
  telegramWebhookSecret: () => process.env.TELEGRAM_WEBHOOK_SECRET,
  /** The single LINE userId allowed into /admin/. Not a secret in itself — a
   *  LINE userId identifies an account but cannot authenticate as one. */
  adminLineUserId: () =>
    process.env.ADMIN_LINE_USER_ID ?? "Ub5c3e37b54e59f479fbf450e2df60d18",
  /** Baked into the one-time admin login link the bot sends over DM, so it must
   *  point at whichever deployment is live. Cutover checklist item. */
  adminBaseUrl: () => process.env.ADMIN_BASE_URL ?? "https://p4p-sakhonmso.vercel.app",
} as const
