-- One-time DDL for the sender_physician_match table.
-- Run this in the Supabase SQL Editor (supabase-js/PostgREST cannot run DDL).
-- Replaces sender-physician-match.csv, which used to be committed to the repo.
--
-- SECURITY: the status/list/ranking pages query Supabase directly from the
-- browser with the public "anon" (publishable) key — see assets/shared.js.
-- Per automation/scripts/fix-supabase-grants.sql, a freshly created table is
-- otherwise readable/writable by that same public key. This table holds real
-- sender emails + matched physician names, and no page ever needs to read it,
-- so it gets RLS enabled with NO anon/authenticated policies at all (deny by
-- default) — only service_role (used by the automation) can touch it.

create table if not exists sender_physician_match (
  sender_email        text primary key,
  sender_display_name text,
  email_count         integer not null default 0,
  extracted_name      text,
  name_source         text,
  matched_physician   text,
  department          text,
  similarity          numeric(4,3),
  matched             boolean not null default false,
  updated_at          timestamptz not null default now()
);

alter table public.sender_physician_match enable row level security;

-- No anon/authenticated policies are created — RLS with zero policies denies
-- all access to those roles by default. service_role bypasses RLS entirely.
revoke all on public.sender_physician_match from anon, authenticated;
grant select, insert, update, delete on public.sender_physician_match to service_role;
