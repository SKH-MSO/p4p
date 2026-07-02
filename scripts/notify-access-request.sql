-- ============================================================================
--  P4P — OPTIONAL: Telegram alert when a new physician requests access
-- ============================================================================
--  ⚠️  VERIFY BEFORE ENABLING. Template, not a tested migration. It needs the
--      pg_net extension and Supabase Vault, and makes a real outbound HTTP call;
--      none of that can be exercised in a plain Postgres. Test on a staging
--      project first.
--
--  Why
--  ---
--  When a new physician submits the access-request form on /verify/, a row lands
--  in access_requests (email + self-reported name). Without a nudge, an admin has
--  to remember to check that table. This fires a Telegram message the moment a
--  NEW request arrives, so the admin can add them to physician_directory quickly.
--  Reuses the same bot the automation already uses (telegram.js).
--
--  Setup (confirm each step against current Supabase docs)
--  -------------------------------------------------------
--    1. Extensions: enable `pg_net` (Database → Extensions).
--    2. Vault: store the bot credentials as secrets (Database → Vault), names:
--         telegram_bot_token   = <BotFather token>
--         telegram_chat_id     = <admin chat/group id>
--    3. Run this file. It creates the trigger function + trigger.
--    4. Test: submit a request for an unknown email on /verify/ and confirm the
--       Telegram message arrives.
--
--  Notifies on INSERT only (first request per email), so repeat attempts — which
--  are ON CONFLICT DO UPDATE, not INSERT — don't spam. Widen to re-requests by
--  also handling UPDATE where OLD.resolved = true if you want.
-- ============================================================================

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
         || 'อีเมล: ' || new.email || E'\n'
         || 'เพิ่มใน physician_directory เพื่ออนุมัติ';

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body    := jsonb_build_object('chat_id', v_chat, 'text', v_text),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  -- Never let a notification failure block the access request.
  raise warning 'notify_access_request failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_notify_access_request on public.access_requests;
create trigger trg_notify_access_request
  after insert on public.access_requests
  for each row execute function public.notify_access_request();
