-- One-time DDL for the sender_physician_match table.
-- Run this in the Supabase SQL Editor (supabase-js/PostgREST cannot run DDL).
-- Replaces sender-physician-match.csv, which used to be committed to the repo.

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
