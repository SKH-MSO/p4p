-- ============================================================================
--  One-time backfill — copy submitted_at from p4p_submissions into each
--  YYYY_MM month table's new submitted_at column, so historical rankings
--  survive the move off p4p_submissions.
--
--  Run AFTER security-rls.sql (which adds the submitted_at column + grant).
--  Matches on a normalised "firstname lastname" = physician_name. This covers
--  the common case; rows the automation matched fuzzily (title/spacing quirks)
--  may not match here — re-run the automation's own backfill for those, or
--  spot-fix. Idempotent: only fills rows whose submitted_at is still NULL.
-- ============================================================================
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename ~ '^[0-9]{4}_[0-9]{2}$'
  loop
    execute format($f$
      update public.%1$I m
         set submitted_at = s.submitted_at
        from public.p4p_submissions s
       where s.work_month = %1$L
         and m.submitted_at is null
         and lower(btrim(m.firstname || ' ' || m.lastname))
           = lower(btrim(s.physician_name))
    $f$, t);
  end loop;
end $$;

-- Verify a month (submitted vs total):
--   select count(*) filter (where submitted_at is not null) as submitted,
--          count(*) as total
--   from public."2569_06";
