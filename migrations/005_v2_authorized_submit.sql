-- NOM.ST_ V2 staging-only guarded booking RPC.
-- Requires migrations 001-004. Apply only to isolated staging Supabase.
-- One transaction: lock token, verify expiry, create booking, consume token.
-- No public token issuer exists yet. Do not enable public customer submissions.
create or replace function public.nomst_v2_submit_authorized(
 p_token_hash text,
 p_id uuid,p_device_code text,p_start date,p_end date,
 p_name text,p_email text,p_phone text,p_ig text,p_purpose text,
 p_fulfillment text,p_location text,p_verification text,
 p_lens boolean,p_grip boolean,p_policy_version text
) returns uuid
language plpgsql security invoker set search_path=public
as $$
declare
 v_key public.nomst_v2_submission_keys%rowtype;
 v_result uuid;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
   raise exception 'INVALID_SUBMISSION_TOKEN' using errcode='22023';
 end if;
 select * into v_key
 from public.nomst_v2_submission_keys
 where token_hash=p_token_hash
 for update;
 if not found or v_key.consumed_at is not null or
    v_key.expires_at <= clock_timestamp() or v_key.reservation_id <> p_id then
   raise exception 'SUBMISSION_NOT_AUTHORIZED' using errcode='22023';
 end if;
 v_result:=public.nomst_v2_create_booking(
   p_id,p_device_code,p_start,p_end,
   p_name,p_email,p_phone,p_ig,p_purpose,
   p_fulfillment,p_location,p_verification,
   p_lens,p_grip,p_policy_version
 );
 update public.nomst_v2_submission_keys
 set consumed_at=clock_timestamp()
 where id=v_key.id and consumed_at is null;
 if not found then
   raise exception 'SUBMISSION_STATE_CONFLICT' using errcode='40001';
 end if;
 return v_result;
end $$;
revoke all on function public.nomst_v2_submit_authorized(
 text,uuid,text,date,date,text,text,text,text,text,text,text,text,boolean,boolean,text
) from public,anon,authenticated;
grant execute on function public.nomst_v2_submit_authorized(
 text,uuid,text,date,date,text,text,text,text,text,text,text,text,boolean,boolean,text
) to service_role;
comment on function public.nomst_v2_submit_authorized(
 text,uuid,text,date,date,text,text,text,text,text,text,text,boolean,boolean,text
) is 'Staging-only atomic single-use submission. No public token issuance is enabled.';
