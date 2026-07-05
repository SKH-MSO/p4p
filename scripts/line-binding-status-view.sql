-- ============================================================================
--  P4P — Admin view: which allow-listed emails have a LINE userId bound yet
-- ============================================================================
--  Run scripts/bind-line-user.sql FIRST — this view reads line_user_bindings.
--
--  Pure reporting, no gating: lists every allow-listed email (same union used
--  by is_sender_allowlisted — physician_directory ∪ matched sender_physician_match
--  rows) alongside whether a LINE userId has been bound to it yet. Query this
--  from the Supabase SQL editor / Table Editor to see who still needs to
--  re-verify through /verify/ before a LINE userId is on file for them.
--
--  Not granted to anon/authenticated — same posture as the tables it reads
--  (deny by default; only service_role/postgres, i.e. the dashboard, can see
--  it). This also sidesteps the Postgres view-ownership subtlety where a plain
--  view can bypass the underlying tables' RLS for whoever it's granted to.
-- ============================================================================

create or replace view public.line_binding_status as
with allowed as (
  select lower(d.email) as email, d.full_name, 'physician_directory'::text as source
  from public.physician_directory d
  where d.active
  union all
  select lower(m.sender_email) as email, m.matched_physician, 'sender_physician_match'::text as source
  from public.sender_physician_match m
  where m.matched
),
-- One row per email: prefer the physician_directory name when an email
-- appears in both sources (manually onboarded AND has since submitted).
dedup as (
  select distinct on (email) email, full_name, source
  from allowed
  order by email, (source = 'physician_directory') desc
)
select
  d.email,
  d.full_name,
  d.source,
  (lb.line_user_id is not null) as line_matched,
  lb.line_user_id,
  lb.line_display_name,
  lb.bound_at
from dedup d
left join public.line_user_bindings lb on lb.email = d.email
order by line_matched asc, d.email;

revoke all on public.line_binding_status from public, anon, authenticated;
grant select on public.line_binding_status to service_role;
