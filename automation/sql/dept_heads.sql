-- One-time DDL + seed for the dept_heads table.
-- Run this in the Supabase SQL Editor (supabase-js/PostgREST cannot run DDL).
-- Replaces the DEPT_HEADS_JSON GitHub secret: heads change often, and
-- secrets are write-only (can't be read back), so score-tracker.mjs and
-- resend-month.mjs now read this table instead via getDeptHeads().
--
-- SECURITY: same reasoning as sql/sender_physician_match.sql — the
-- status/list/ranking pages query Supabase directly from the browser with
-- the public "anon" key (see assets/shared.js), and a freshly created table
-- is otherwise readable/writable by that same public key (per
-- automation/scripts/fix-supabase-grants.sql). No page needs this table, so
-- RLS is enabled with NO anon/authenticated policies at all — only
-- service_role (used by the automation) can access it.
--
-- To manually update a head's email later: Supabase Dashboard -> Table
-- Editor -> dept_heads -> edit the head_email cell directly, or:
--   UPDATE dept_heads SET head_email = 'new@email.com' WHERE department = 'ศัลยกรรม';

create table if not exists dept_heads (
  department text primary key,
  head_email text,
  updated_at timestamptz not null default now()
);

alter table public.dept_heads enable row level security;
revoke all on public.dept_heads from anon, authenticated;
grant select, insert, update, delete on public.dept_heads to service_role;

-- Seed with the current mapping (built from the "head" Gmail label earlier
-- this session).
insert into dept_heads (department, head_email) values
  ('กุมารเวชกรรม', 'abunto@hotmail.com'),
  ('จักษุวิทยา', 'skch1136@gmail.com'),
  ('จิตเวชและยาเสพติด', 'nithinanmd@hotmail.com'),
  ('เทคนิคการแพทย์และพยาธิวิทยาคลินิก', 'thirunda123@hotmail.com'),
  ('นิติเวช', 'dr.apisara@gmail.com'),
  ('ผู้ป่วยนอก', 'meepoohjew@hotmail.com'),
  ('พยาธิวิทยากายวิภาค', 'sirathird@gmail.com'),
  ('รังสีวิทยา', 'orawanxray@gmail.com'),
  ('วิสัญญีวิทยา', 'dkuakulkiat@gmail.com'),
  ('เวชกรรมฟื้นฟู', 'nat_kaning@yahoo.com'),
  ('เวชกรรมสังคม', 'suppasarun33@gmail.com'),
  ('เวชศาสตร์ฉุกเฉิน', 'alps209@gmail.com'),
  ('ศัลยกรรม', 'dr-kj@hotmail.com'),
  ('ศัลยกรรมออร์โธปิดิกส์', 'opaspmk@gmail.com'),
  ('สูติ-นรีเวชกรรม', 'chsutjarit@gmail.com'),
  ('โสต ศอ นาสิก', 'naruwat@yahoo.com'),
  ('อาชีวเวชกรรม', 'pisit222@gmail.com'),
  ('อายุรกรรม', 'meepoohjew@hotmail.com')
on conflict (department) do update set head_email = excluded.head_email;
