-- ============================================================================
--  P4P — Add "email display name" line to the Telegram access-request alert
-- ============================================================================
--  ⚠️  Run scripts/telegram-approve-buttons.sql FIRST — this file only replaces
--      notify_access_request() again, adding one more line to the message.
--
--  When a physician requests access on /verify/, the admin currently only sees
--  the name they self-selected from the dropdown and their email address.
--  This adds a cross-check: if that email address has ever sent a P4P
--  submission (i.e. it has a row in sender_physician_match, populated by the
--  "Match Sender Emails" GitHub Action), show the display name from that
--  email's own "From" header. Lets the admin sanity-check that the requester
--  is who they claim to be before tapping ✅.
--
--  The line is omitted entirely when there's no record yet (email never seen)
--  or the record has a blank display name — nothing to show, so nothing shown.
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
  v_display text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into v_chat  from vault.decrypted_secrets where name = 'telegram_chat_id';
  if v_token is null or v_chat is null then
    raise warning 'notify_access_request: telegram secrets missing in Vault';
    return new;
  end if;

  select sender_display_name into v_display
  from public.sender_physician_match
  where sender_email = new.email;

  v_text := '🔔 คำขอเข้าใช้งาน P4P ใหม่' || E'\n'
         || 'ชื่อที่แจ้งในคำขอ: ' || coalesce(new.name, '(ไม่ระบุ)') || E'\n'
         || 'อีเมล: ' || new.email;

  if v_display is not null and btrim(v_display) <> '' then
    v_text := v_text || E'\n' || 'ชื่อที่แสดงในอีเมล: ' || v_display;
  end if;

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
