-- ============================================================================
--  P4P — Flag name mismatch between dropdown pick and email display name
-- ============================================================================
--  ⚠️  Run scripts/telegram-approve-sender-display-name.sql FIRST — this file
--      only replaces notify_access_request() again, adding a match/mismatch
--      indicator under the two names it already prints.
--
--  telegram-approve-sender-display-name.sql shows both names side by side
--  ("ชื่อที่แจ้งในคำขอ" from the /verify/ dropdown vs "ชื่อที่แสดงในอีเมล" from
--  sender_physician_match) but leaves it to the admin to eyeball whether they
--  actually agree. This adds that comparison directly in the alert so a
--  mismatch is obvious before tapping ✅.
--
--  Comparison is intentionally loose, not a hard gate — it only changes what
--  text is shown, never whether the request can be approved:
--    1. Both names are lowercased, whitespace-collapsed, and stripped of a
--       common Thai/English title prefix (นพ./พญ./นาย/นาง/นางสาว/ดร./ผศ./
--       รศ./ศ./Dr./Mr./Mrs./Ms.) so titles alone don't cause a false mismatch.
--    2. Exact match after normalizing            -> ✅ ชื่อตรงกัน
--    3. One normalized name contains the other    -> ⚠️ ชื่อใกล้เคียงกัน (handles
--       an email display name that's missing a last name, a common case)
--    4. Otherwise                                  -> ❗ ชื่อไม่ตรงกัน โปรดตรวจสอบ
--  The indicator is only shown when there's an email display name to compare
--  against at all (same condition as the line above it).
-- ============================================================================

create or replace function public.notify_access_request()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token        text;
  v_chat         text;
  v_text         text;
  v_display      text;
  v_name_norm    text;
  v_display_norm text;
  v_title_re     constant text :=
    '^(นพ\.?|พญ\.?|นางสาว|น\.ส\.?|นาง|นาย|ดร\.?|ผศ\.?|รศ\.?|ศ\.?|dr\.?|mr\.?|mrs\.?|ms\.?)\s*';
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

  if v_display is not null and btrim(v_display) <> '' and new.name is not null and btrim(new.name) <> '' then
    v_text := v_text || E'\n' || 'ชื่อที่แสดงในอีเมล: ' || v_display;

    v_name_norm    := regexp_replace(regexp_replace(lower(btrim(new.name)), v_title_re, ''), '\s+', ' ', 'g');
    v_display_norm := regexp_replace(regexp_replace(lower(btrim(v_display)), v_title_re, ''), '\s+', ' ', 'g');

    if v_name_norm = v_display_norm then
      v_text := v_text || E'\n' || '✅ ชื่อตรงกัน';
    elsif position((' ' || v_display_norm || ' ') in (' ' || v_name_norm || ' ')) > 0
       or position((' ' || v_name_norm || ' ') in (' ' || v_display_norm || ' ')) > 0 then
      v_text := v_text || E'\n' || '⚠️ ชื่อใกล้เคียงกัน โปรดตรวจสอบ';
    else
      v_text := v_text || E'\n' || '❗ ชื่อไม่ตรงกัน โปรดตรวจสอบก่อนอนุมัติ';
    end if;
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
