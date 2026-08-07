-- ============================================================================
--  P4P — LINE binding as a REAL second factor (server-verified ID tokens)
-- ============================================================================
--  Run scripts/bind-line-user.sql and scripts/line-bind-gate.sql FIRST.
--
--  THE PROBLEM THIS FIXES
--  ----------------------
--  bind_line_user_id(p_line_user_id text, ...) takes the LINE userId as a
--  PARAMETER. It correctly reads the email from auth.jwt(), so a user can only
--  bind their own email — but the LINE identity is whatever the client says it
--  is. liff.getProfile() runs in the browser; its output is just a string the
--  page chooses to send. Any holder of a valid session could call the RPC
--  directly with any userId.
--
--  So the binding was never a second factor, and a "does the live userId match
--  the stored one?" check would not have made it one: the client supplies the
--  value being compared. On first bind an attacker sets it; afterwards anyone
--  who learns the opaque U… string can replay it.
--
--  THE FIX
--  -------
--  LIFF also exposes liff.getIDToken() — an OpenID Connect JWT signed by LINE.
--  main.js POSTs it to https://api.line.me/oauth2/v2.1/verify with the LINE
--  Login channel id as client_id; LINE validates the signature, expiry and
--  audience and returns the claims. The `sub` claim is then an AUTHENTICATED
--  LINE userId that the client cannot forge.
--
--  This file moves the write behind that verification:
--    • bind_line_user_id_verified() is service_role ONLY. The browser can no
--      longer reach it; only main.js can, and only after verifying with LINE.
--    • A mismatch (a different, verified LINE account presenting itself for an
--      already-bound email) is REFUSED and alerted, not silently accepted.
--    • line_verified_sessions records WHICH SESSION proved the LINE identity.
--      Without this the mismatch check gates nothing: an attacker who fails the
--      bind could still walk straight to /status/, because the old gate only
--      asked "is this email bound to anything?" — which is true, thanks to the
--      victim's own earlier bind.
--
--  ROLLOUT ORDER — the revoke at the bottom WILL break the currently deployed
--  /verify/, which still calls bind_line_user_id directly. Blocks 1-3 are
--  additive and safe to run now; Block 4 runs only after the new main.js and
--  verify/app.js are deployed. Same ordering trap as list_all_physicians.
--
--  PREREQUISITE: the /verify/ LIFF app needs the `openid` scope, or
--  liff.getIDToken() returns null and every bind fails. getProfile() only
--  needs `profile`, so this is very likely NOT enabled today — check the LINE
--  Developers console before enabling enforcement.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Block 1 — per-session proof of LINE identity.
--
--   Keyed on the Supabase access token's `session_id` claim, which is stable
--   across token refreshes, so a physician verifies once per session rather
--   than once per page load. verified_at gives the proof a shelf life: this is
--   also the only expiry anything in this system has, since auth.sessions.
--   not_after is NULL on every row and the session cookie lasts 400 days.
-- ----------------------------------------------------------------------------
create table if not exists public.line_verified_sessions (
  session_id    text primary key,
  email         text        not null,
  line_user_id  text        not null,
  verified_at   timestamptz not null default now()
);
create index if not exists line_verified_sessions_email_idx
  on public.line_verified_sessions (email);

alter table public.line_verified_sessions enable row level security;
revoke all on public.line_verified_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.line_verified_sessions to service_role;


-- ----------------------------------------------------------------------------
-- Block 2 — the verified bind. service_role ONLY.
--
--   p_line_user_id here is NOT client input: main.js only ever passes the
--   `sub` claim that LINE itself returned from the verify endpoint.
--
--   Returns jsonb {status: bound|match|mismatch|invalid} so main.js can tell
--   the three apart — a mismatch must NOT be reported to the client as a
--   retryable failure, and must not count toward line_bind_attempts (that
--   counter exists for device/permission problems, and letting a mismatch
--   burn it down to the fail-open limit would hand an attacker a way in).
-- ----------------------------------------------------------------------------
create or replace function public.bind_line_user_id_verified(
  p_email             text,
  p_line_user_id      text,
  p_line_display_name text default null,
  p_session_id        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_uid      text := btrim(coalesce(p_line_user_id, ''));
  v_name     text := nullif(btrim(coalesce(p_line_display_name, '')), '');
  v_sid      text := nullif(btrim(coalesce(p_session_id, '')), '');
  v_existing text;
  v_token    text;
  v_chat     text;
begin
  if v_email = '' or v_uid = '' then
    return jsonb_build_object('status', 'invalid');
  end if;

  select line_user_id into v_existing
    from public.line_user_bindings where email = v_email;

  -- ── Mismatch: refuse, alert, record nothing ──────────────────────────────
  if v_existing is not null and v_existing <> v_uid then
    select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_bot_token';
    select decrypted_secret into v_chat  from vault.decrypted_secrets where name = 'telegram_chat_id';
    if v_token is not null and v_chat is not null then
      perform net.http_post(
        url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
        body    := jsonb_build_object(
          'chat_id', v_chat,
          'text', '🚨 การเข้าใช้งานผิดปกติ (P4P)' || E'\n' ||
                  'อีเมล: ' || v_email || E'\n' ||
                  'บัญชี LINE ไม่ตรงกับที่ผูกไว้ครั้งแรก' || E'\n' ||
                  'ผูกไว้: ' || v_existing || E'\n' ||
                  'ที่พยายามเข้า: ' || v_uid || E'\n' ||
                  'ระบบปฏิเสธการเข้าใช้งานแล้ว หากเป็นการเปลี่ยนเครื่อง/บัญชี LINE จริง ' ||
                  'ให้ลบแถวของอีเมลนี้ในตาราง line_user_bindings เพื่อให้ผูกใหม่ได้'
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    end if;
    return jsonb_build_object('status', 'mismatch');
  end if;

  -- ── First bind (trust on first use) ──────────────────────────────────────
  if v_existing is null then
    insert into public.line_user_bindings (email, line_user_id, line_display_name, bound_at)
    values (v_email, v_uid, v_name, now())
    on conflict (email) do nothing;

    update public.physician_directory    set line_user_id = v_uid where lower(email)        = v_email;
    update public.sender_physician_match set line_user_id = v_uid where lower(sender_email) = v_email;
  else
    -- ── Match: refresh the display name only; the userId is immutable ──────
    update public.line_user_bindings
      set line_display_name = coalesce(v_name, line_display_name)
      where email = v_email;
  end if;

  delete from public.line_bind_attempts where email = v_email;

  if v_sid is not null then
    insert into public.line_verified_sessions (session_id, email, line_user_id, verified_at)
    values (v_sid, v_email, v_uid, now())
    on conflict (session_id) do update
      set email = excluded.email,
          line_user_id = excluded.line_user_id,
          verified_at  = now();
  end if;

  return jsonb_build_object('status', case when v_existing is null then 'bound' else 'match' end);
exception when others then
  raise warning 'bind_line_user_id_verified failed for %: %', v_email, sqlerrm;
  return jsonb_build_object('status', 'error');
end;
$$;

revoke all on function public.bind_line_user_id_verified(text, text, text, text) from public, anon, authenticated;
grant execute on function public.bind_line_user_id_verified(text, text, text, text) to service_role;


-- ----------------------------------------------------------------------------
-- Block 3 — gate status WITHOUT an email parameter.
--
--   The old get_line_bind_gate_status(p_email) is granted to anon and takes
--   any address, which makes it an unauthenticated "is this person a
--   registered physician?" oracle. It is also called by main.js WITH THE ANON
--   KEY, which is why it could not simply be revoked: the call would 403, the
--   handler would swallow it and return null, and main.js would then skip the
--   whole gate — including the blocked_emails denylist.
--
--   This replacement takes no argument and reads the email from the caller's
--   own JWT, so there is nothing to enumerate. main.js must call it with the
--   USER'S access token, not the anon key.
-- ----------------------------------------------------------------------------
create or replace function public.get_line_bind_gate_status_self()
returns table(is_blocked boolean, is_bound boolean, attempts integer, session_verified boolean)
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (
      select 1 from public.blocked_emails b
      where lower(b.email) = lower(auth.jwt() ->> 'email')
    ),
    exists (
      select 1 from public.line_user_bindings lb
      where lb.email = lower(auth.jwt() ->> 'email')
    ),
    coalesce((
      select a.attempts from public.line_bind_attempts a
      where a.email = lower(auth.jwt() ->> 'email')
    ), 0),
    exists (
      select 1 from public.line_verified_sessions s
      where s.session_id = (auth.jwt() ->> 'session_id')
        and s.email      = lower(auth.jwt() ->> 'email')
        and s.verified_at > now() - interval '30 days'
    );
$$;

revoke all on function public.get_line_bind_gate_status_self() from public, anon;
grant execute on function public.get_line_bind_gate_status_self() to authenticated, service_role;


-- ============================================================================
-- Block 4 — POST-DEPLOY ONLY. Do not run until the new main.js + verify/app.js
--           are live, or the currently deployed /verify/ breaks: it calls
--           bind_line_user_id() directly and would start failing every bind.
-- ============================================================================
--
--   revoke all on function public.bind_line_user_id(text, text)        from public, anon, authenticated;
--   revoke all on function public.get_line_bind_gate_status(text)      from public, anon, authenticated;
--   drop function if exists public.bind_line_user_id(text, text);
--   drop function if exists public.get_line_bind_gate_status(text);
--
--   Verify afterwards — expect only is_sender_allowlisted and
--   log_access_request to remain anon-executable (plus list_all_physicians
--   until that one is dropped too, see security-hardening-2026-08.sql):
--
--     select p.proname
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
--     order by p.proname;
--
--   Admin runbook — a physician legitimately changed phone or LINE account:
--     delete from public.line_user_bindings   where email = '<their email>';
--     delete from public.line_verified_sessions where email = '<their email>';
--   Their next visit re-binds (trust on first use) with no OTP re-entry.
-- ============================================================================
