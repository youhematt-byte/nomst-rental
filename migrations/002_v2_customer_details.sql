-- NOM.ST_ v2: staging-only customer request data model.
-- Apply ONLY after 001_v2_reservations.sql on an isolated staging database.
-- Do not use this migration to enable public bookings.
begin;
create table if not exists public.nomst_v2_customers (
  reservation_id uuid primary key references public.nomst_v2_reservations(id) on delete restrict,
  customer_name text not null check (char_length(customer_name) between 1 and 80),
  customer_email text not null check (char_length(customer_email) between 3 and 254),
  customer_phone text not null check (customer_phone ~ '^09[0-9]{8}$'),
  instagram text not null check (char_length(instagram) between 1 and 80),
  rental_purpose text not null check (char_length(rental_purpose) between 1 and 160),
  fulfillment text not null check (fulfillment in ('meet','ship')),
  fulfillment_location text not null check (char_length(fulfillment_location) between 1 and 200),
  verification_method text not null check (verification_method in ('in_person','docs','phone','none')),
  wants_lens boolean not null default false,
  wants_grip boolean not null default false,
  rental_amount_twd integer not null check (rental_amount_twd >= 0),
  accessories_amount_twd integer not null check (accessories_amount_twd >= 0),
  security_deposit_twd integer not null check (security_deposit_twd >= 0),
  consent_policy_version text not null check (char_length(consent_policy_version) between 1 and 40),
  consent_recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check ((fulfillment='meet' and verification_method='in_person') or
         (fulfillment='ship' and verification_method in ('docs','phone','none')))
);
alter table public.nomst_v2_customers enable row level security;
revoke all on public.nomst_v2_customers from public, anon, authenticated;
comment on table public.nomst_v2_customers is
  'Sensitive staging booking data. Service backend only. No ID scans, tokens, or signed contracts stored in this table.';
commit;
