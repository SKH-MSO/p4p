// Shared Supabase config + a thin PostgREST RPC helper for the server.
//
// One place for the project URL and the PUBLISHABLE (anon) key, and one place
// that knows the REST header shape (apikey + Authorization + Content-Type) —
// previously hand-rolled at every call site, which is exactly how one call
// silently drifts from the others. The Auth endpoints (/auth/v1/*) have their
// own header shapes and stay inline in main.js.
const axios = require("axios")

const SUPABASE_URL = "https://zjeizbrzcltkgtlmkbji.supabase.co"
// PUBLISHABLE (anon) key — safe on the server and in the browser; the data is
// protected by Row Level Security (scripts/security-rls-auth.sql).
const SUPABASE_ANON = "sb_publishable_TcCSpznim4fi0Y7E_zuAsg_op19VZQ-"

function restHeaders(key) {
  return {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
  }
}

// Call a Postgres function via PostgREST. `key` selects the role: SUPABASE_ANON
// for the yes/no/count oracle RPCs (default), or the service-role key for the
// privileged approve/reject RPCs. Returns the axios response promise.
function rpc(fn, body, key = SUPABASE_ANON) {
  return axios.post(SUPABASE_URL + "/rest/v1/rpc/" + fn, body, {
    headers: restHeaders(key),
    timeout: 8000,
  })
}

module.exports = { SUPABASE_URL, SUPABASE_ANON, restHeaders, rpc }
