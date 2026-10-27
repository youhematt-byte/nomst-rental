-- NOM.ST_ v2 STAGING ONLY: atomic reservation + customer details.
-- Apply after 001 and 002 in an isolated staging Supabase project.
-- Requires service_role invocation from the server. Never expose service key to browser.
create or replace function public.nomst_v2_create_booking(
 p_id uuid,p_device_code text,p_start date,p_end date,
 p_name text,p_email text,p_phone text,p_ig text,p_purpose text,
 p_fulfillment text,p_location text,p_verification text,
 p_lens boolean,p_grip boolean,p_policy_version text
) returns uuid language plpgsql security invoker set search_path=public as $$
declare
 n integer;
 rent integer;
 extras integer;
 deposit integer;
begin
 n:=p_end-p_start+1;
 if p_id is null or p_device_code <> 'VIVO-X300-PRO-1TB-001' or
    p_start is null or p_end is null or n not between 1 and 30 or
    p_start < (now() at time zone 'Asia/Taipei')::date then
   raise exception 'INVALID_BOOKING_DATES' using errcode='22023';
 end if;
 if p_fulfillment='ship' and
    p_start < (now() at time zone 'Asia/Taipei')::date + 4 then
   raise exception 'SHIPPING_LEAD_TIME' using errcode='22023';
 end if;
 if p_name is null or char_length(trim(p_name)) not between 1 and 80 or
    p_email is null or char_length(trim(p_email)) not between 3 and 254 or
    p_phone !~ '^09[0-9]{8}$' or p_ig is null or
    char_length(trim(p_ig)) not between 1 and 80 or p_purpose is null or
    char_length(trim(p_purpose)) not between 1 and 160 or
    p_location is null or char_length(trim(p_location)) not between 1 and 200 or
    p_policy_version is null or char_length(trim(p_policy_version)) not between 1 and 40 or
    not ((p_fulfillment='meet' and p_verification='in_person') or
         (p_fulfillment='ship' and p_verification in ('docs','phone','none'))) then
   raise exception 'INVALID_CUSTOMER_DETAILS' using errcode='22023';
 end if;
 rent:=n*(case when n<=2 then 800 when n<=4 then 700 else 600 end);
 extras:=(case when p_lens then 300 else 0 end)+(case when p_grip then 200 else 0 end);
 deposit:=case when p_fulfillment='meet' or p_verification='docs' then 3000
               when p_verification='phone' then 6000 else 10000 end;
 insert into public.nomst_v2_reservations(id,device_code,start_date,end_date,status)
 values(p_id,p_device_code,p_start,p_end,'pending');
 insert into public.nomst_v2_customers(
  reservation_id,customer_name,customer_email,customer_phone,instagram,
  rental_purpose,fulfillment,fulfillment_location,verification_method,
  wants_lens,wants_grip,rental_amount_twd,accessories_amount_twd,
  security_deposit_twd,consent_policy_version)
 values(p_id,trim(p_name),trim(p_email),p_phone,trim(p_ig),trim(p_purpose),
        p_fulfillment,trim(p_location),p_verification,p_lens,p_grip,
        rent,extras,deposit,p_policy_version);
 return p_id;
end $$;
revoke all on function public.nomst_v2_create_booking(
 uuid,text,date,date,text,text,text,text,text,text,text,text,boolean,boolean,text
) from public,anon,authenticated;
grant execute on function public.nomst_v2_create_booking(
 uuid,text,date,date,text,text,text,text,text,text,text,text,boolean,boolean,text
) to service_role;
