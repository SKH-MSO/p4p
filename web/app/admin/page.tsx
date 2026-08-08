import AdminClient from "./AdminClient"

/**
 * The roster CRUD dashboard.
 *
 * No server-side gate on the HTML: the page renders an "unauthorized" state
 * client-side when GET /admin/api/tables returns 401, and that route IS gated.
 * The page itself never talks to Supabase — only to same-origin /admin/api/*,
 * which hold the service-role key server-side. Same posture as the Express
 * version.
 */
export const dynamic = "force-dynamic"

export const metadata = { title: "ผู้ดูแลระบบ — SAKHONMSO P4P" }

export default function AdminPage() {
  return <AdminClient />
}
