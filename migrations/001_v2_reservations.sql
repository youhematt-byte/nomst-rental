-- NOM.ST_ v2 database migration (REVIEW BEFORE APPLYING)
-- Creates a separate v2 reservation table. Does not modify existing bookings.
-- Requires pgcrypto and btree_gist; run only in a staging Supabase project first.
create extension if not exists pgcrypto;
create extension if not exists btree_gist;
create table if not exists public.nomst_v2_reservations (
  id uuid primary key default gen_random_uuid(),
  device_code text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'pending'
    check (status in ('pending','confirmed','completed','cancelled')),
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date - start_date between 0 and 29)
);
-- Prevent two active reservations from occupying any overlapping calendar day.
alter table public.nomst_v2_reservations
  add constraint nomst_v2_no_overlap
  exclude using gist (
    device_code with =,
    daterange(start_date, end_date + 1, '[)') with &&
  ) where (status in ('pending','confirmed'));
alter table public.nomst_v2_reservations enable row level security;
revoke all on public.nomst_v2_reservations from anon, authenticated;
-- Service-role backend access only; no browser-side insert/read policies.
comment on table public.nomst_v2_reservations is
  'Staging v2 reservation inventory. Never store identity documents or customer PII here.';
