-- NOM.ST_ v2 staging-only public submission guard.
-- Apply in an isolated staging Supabase project after migrations 001-003.
-- Draft issuance is intentionally disabled until anti-abuse and verified consent are implemented.
create table if not exists public.nomst_v2_submission_keys (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  reservation_id uuid not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.nomst_v2_submission_keys enable row level security;
revoke all on public.nomst_v2_submission_keys from public, anon, authenticated;
comment on table public.nomst_v2_submission_keys is
  'Staging-only idempotency and submission authorization records. Never store raw bearer tokens.';
-- No public issuance endpoint is provided. Keys may only be provisioned by an approved
-- authenticated server workflow after rate limits, consent, and abuse prevention are verified.
