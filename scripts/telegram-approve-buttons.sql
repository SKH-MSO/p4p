-- ============================================================================
--  P4P — OPTIONAL: Approve/Reject buttons on the Telegram access-request alert
-- ============================================================================
--  ⚠️  Run scripts/notify-access-request.sql FIRST — this file replaces its
--      trigger function and depends on the access_requests table it creates.
--
--  Adds inline "✅ อนุมัติ" / "❌ ปฏิเสธ" buttons to the Telegram alert, so an
--  admin can approve a new physician straight from the chat message — no
--  Supabase Table Editor needed. Requires the webhook handler in main.js
--  (POST /telegram/webhook) to receive the button click, plus these Vercel env
--  vars: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY.
--  See scripts/setup-telegram-webhook.mjs for the one-time webhook registration.
--
--  How a click is authorized: the button's callback_data carries a random
--  per-request token (NOT the service role key or anything secret), so main.js
--  can identify which request to act on. The actual privileged DB write happens
--  server-side using the service_role key that only Vercel holds — the token
--  alone can't be replayed to bypass anything except "mark this one pending
--  request approved/rejected", which is exactly the action a button click
--  should be allowed to do.
-- ============================================================================

-- One short random token per request, used as the button's callback_data so it
-- never has to carry the full email (Telegram caps callback_data at 64 bytes).
alter table public.access_requests add column if not exists approve_token text;
update public.access_requests
  set approve_token = substr(md5(random()::text || clock_timestamp()::text || email), 1, 12)
  where approve_token is null;
alter table public.access_requests
  alter column approve_token set default substr(md5(random()::text || clock_timestamp()::text), 1, 12);
create unique index if not exists access_requests_approve_token_idx
  on public.access_requests (approve_token);

-- Called by the webhook handler (service_role only) when the admin taps ✅.
-- Adds the physician to the allow-list and marks the request resolved,
-- atomically. Re-tapping an already-resolved button is a no-op (returns false).
create or replace function public.approve_access_request(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_requests%rowtype;
begin
  select * into v_row from public.access_requests where approve_token = p_token and not resolved;
  if not found then
    return false;
  end if;

  insert into public.physician_directory (email, full_name)
  values (v_row.email, v_row.name)
  on conflict (email) do update
    set full_name = coalesce(excluded.full_name, public.physician_directory.full_name),
        active    = true;

  update public.access_requests set resolved = true where approve_token = p_token;
  return true;
end;
$$;

-- Called when the admin taps ❌. Just marks the request resolved without
-- adding anything to the allow-list.
create or replace function public.reject_access_request(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.access_requests set resolved = true where approve_token = p_token and not resolved;
  return found;
end;
$$;

revoke all on function public.approve_access_request(text) from public;
revoke all on function public.reject_access_request(text) from public;
grant execute on function public.approve_access_request(text) to service_role;
grant execute on function public.reject_access_request(text) to service_role;

-- Replace the notifier to include the inline keyboard. Same trigger as before
-- (created in notify-access-request.sql) now calls this updated function body.
create or replace function public.notify_access_request()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token   text;
  v_chat    text;
  v_text    text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into v_chat  from vault.decrypted_secrets where name = 'telegram_chat_id';
  if v_token is null or v_chat is null then
    raise warning 'notify_access_request: telegram secrets missing in Vault';
    return new;
  end if;

  v_text := '🔔 คำขอเข้าใช้งาน P4P ใหม่' || E'\n'
         || 'ชื่อ: '   || coalesce(new.name, '(ไม่ระบุ)') || E'\n'
         || 'อีเมล: ' || new.email;

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body    := jsonb_build_object(
      'chat_id', v_chat,
      'text', v_text,
      'reply_markup', jsonb_build_object(
        'inline_keyboard', jsonb_build_array(
          jsonb_build_array(
            jsonb_build_object('text', '✅ อนุมัติ', 'callback_data', 'appr|' || new.approve_token),
            jsonb_build_object('text', '❌ ปฏิเสธ',  'callback_data', 'rej|'  || new.approve_token)
          )
        )
      )
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  raise warning 'notify_access_request failed: %', sqlerrm;
  return new;
end;
$$;
