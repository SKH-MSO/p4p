-- One-time DDL + seed for the management_stipends table.
-- Run this in the Supabase SQL Editor (supabase-js/PostgREST cannot run DDL).
--
-- Replaces process/process.js's hardcoded MANAGEMENT_DATA array and
-- DEPT_HEAD_SET — real physicians' names, roles, and monthly stipend
-- amounts (compensation data) were previously committed straight into
-- source, permanently baking PII into git history. Same reasoning as
-- automation/sql/dept_heads.sql: this data changes occasionally (a role
-- changes, a stipend is adjusted), and a Table Editor row-edit beats a
-- code change + redeploy.
--
-- SECURITY: same posture as dept_heads.sql / sender_physician_match.sql —
-- no page ever reads this table (process.js is a standalone Node script,
-- not a browser client), so RLS is enabled with NO anon/authenticated
-- policies at all. Only service_role (used by process.js) can access it.
--
-- To edit later: Supabase Dashboard -> Table Editor -> management_stipends
-- -> edit the row directly, or:
--   UPDATE management_stipends SET amount = 1200 WHERE physician_name = 'ศิรดา แสงไพบูลย์';

create table if not exists management_stipends (
  -- Normalised "firstname lastname" (trimmed, single-spaced) — matches the
  -- key process/process.js's normaliseName() already produces, so lookups
  -- against roster rows need no extra transformation.
  physician_name text primary key,
  remark         text,
  amount         numeric not null default 0,
  is_dept_head   boolean not null default false,
  updated_at     timestamptz not null default now()
);

alter table public.management_stipends enable row level security;
revoke all on public.management_stipends from anon, authenticated;
grant select, insert, update, delete on public.management_stipends to service_role;

-- Seed with the values previously hardcoded in process/process.js
-- (MANAGEMENT_DATA + DEPT_HEAD_SET, merged 1:1 — every name in
-- DEPT_HEAD_SET was already present in MANAGEMENT_DATA).
insert into management_stipends (physician_name, remark, amount, is_dept_head) values
  ('ศิริพันธ์ บุญโต',             'รองผู้อำนวยการ',    7000, true),
  ('นิธินันท์ สร้อยอากาศ',         'หัวหน้ากลุ่มงาน',   1000, true),
  ('อภิสรา กูลวงศ์ธนโรจน์',       'หัวหน้ากลุ่มงาน',   1000, true),
  ('ศิรดา แสงไพบูลย์',            'หัวหน้ากลุ่มงาน',   1000, true),
  ('ณัฏฐพัชร จันทร์หอม',          'ผู้ช่วยผู้อำนวยการ', 3000, false),
  ('ลักขณา จิราพงษ์',             'ผู้ช่วยผู้อำนวยการ', 3000, false),
  ('อรวรรณ อุตราวิสิทธิกุล',      'หัวหน้ากลุ่มงาน',   1000, true),
  ('ดวงพร เกื้อกูลเกียรติ',        'หัวหน้ากลุ่มงาน',   1000, true),
  ('พงศ์พจน์ ฉุยฉาย',             'ผู้ช่วยผู้อำนวยการ', 3000, false),
  ('ทรงพล โพธิ์สุวรรณ',           'ประธาน PCT มะเร็ง',   800, false),
  ('ฉัตรดาว สุจริต',              'ผู้ช่วยผู้อำนวยการ', 3000, true),
  ('พิสิษฐ์ เลิศเชาวพัฒน์',       'หัวหน้ากลุ่มงาน',   1000, true),
  ('วราวุธ เมธีศิริวัฒน์',         'รองผู้อำนวยการ',    7000, false),
  ('ศุภศรัณย์ ศุภพัฒนพงศ์',        'รองผู้อำนวยการ',    7000, false),
  ('ธิรัญฎา สุทธิพงศ์',            'ผู้ช่วยผู้อำนวยการ', 3000, true),
  ('ธญาภร ลิขิตธรรมากุล',          'หัวหน้ากลุ่มงาน',   1000, true),
  ('นฤวัต เกสรสุคนธ์',            'หัวหน้ากลุ่มงาน',   1000, true),
  ('พยุงศักดิ์ ศักดาภิพาณิชย์',   'ประธาน PCT ENT',      800, false),
  ('อัญชลี ชุ่มแจ่ม',             'ผู้ช่วยผู้อำนวยการ', 3000, false),
  ('สงกรานต์ ชุนหวัฒนา',          'หัวหน้ากลุ่มงาน',   1000, true),
  ('โอภาส ไชยมหาพฤกษ์',           'หัวหน้ากลุ่มงาน',   1000, true),
  ('เกษมศักดิ์ จึงจรูญ',           'หัวหน้ากลุ่มงาน',   1000, true)
on conflict (physician_name) do update set
  remark       = excluded.remark,
  amount       = excluded.amount,
  is_dept_head = excluded.is_dept_head,
  updated_at   = now();
