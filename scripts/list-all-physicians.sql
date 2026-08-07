-- ============================================================================
--  ⚠️  SUPERSEDED — the dropdown this backs was REMOVED. Do not reintroduce.
-- ============================================================================
--  This function is a PII leak and is scheduled for DROP — see the tail of
--  scripts/security-hardening-2026-08.sql for the exact statement and the
--  ordering constraint (the app change must be DEPLOYED first).
--
--  Why it was removed
--  ------------------
--  The reasoning in the original header (kept below) contains one wrong step:
--  it argues this "keeps the same exposure as the old free-text field, which
--  also just captured a self-reported name". That compares the wrong things.
--  The free-text field only ever moved data INTO the system — one name, typed
--  by the person themselves. This function moves data OUT: it returns all ~250
--  physician names, and because the request-access step runs BEFORE login, it
--  has to be executable by `anon`. The publishable key is (correctly) in page
--  source, so in practice this published the hospital's entire physician roster
--  to anyone who looked. Confirmed on the live project: 250 names returned,
--  238 recorded calls.
--
--  RLS deliberately restricts firstname/lastname to allow-listed authenticated
--  users; SECURITY DEFINER here bypassed exactly that control. /verify/ is back
--  to a length-capped, control-character-stripped free-text field
--  (verify/index.html + verify/app.js sanitizeName(), with the authoritative
--  cleaning server-side in log_access_request()). The admin already sees the
--  name and email in the Telegram approval alert, so the dropdown only ever
--  saved a typo.
--
--  ---------------------------- ORIGINAL HEADER -------------------------------
--  The "request access" step on /verify/ used to be a free-text name field.
--  This backs a dropdown instead: every distinct "firstname lastname" that has
--  ever appeared in ANY monthly roster table (YYYY_MM), so an unregistered
--  physician picks their own name rather than typing it.
--
--  SECURITY DEFINER because roster tables have no anon/authenticated grants
--  (locked down in security-rls-auth.sql) — this function only ever returns
--  names, never department/score/submission data, keeping the same exposure
--  as the old free-text field (which also just captured a self-reported name).
--
--  Sorting: returned in whatever order Postgres's default collation gives;
--  the actual Thai-dictionary-correct sort happens client-side in
--  verify/app.js via Intl.Collator, since it's far more reliably tested there
--  than guessing at Postgres ICU collation availability on this project.
-- ============================================================================

create or replace function public.list_all_physicians()
returns table (full_name text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  t     text;
  parts text[] := '{}';
  sql   text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename ~ '^[0-9]{4}_[0-9]{2}$'
  loop
    parts := parts || format(
      $f$select trim(both ' ' from coalesce(firstname, '') || ' ' || coalesce(lastname, '')) as full_name
         from public.%I$f$,
      t
    );
  end loop;

  if array_length(parts, 1) is null then
    return; -- no roster tables exist yet
  end if;

  sql := 'select distinct s.full_name from (' || array_to_string(parts, ' union all ') || ') s where s.full_name <> ''''';
  return query execute sql;
end;
$$;

revoke all on function public.list_all_physicians() from public;
grant execute on function public.list_all_physicians() to anon, authenticated;
