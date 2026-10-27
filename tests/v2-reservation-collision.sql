-- NOM.ST_ 2.0 STAGING VERIFICATION ONLY.
-- Run after migrations/001_v2_reservations.sql in an isolated STAGING Supabase SQL Editor.
-- No real customer data. All test writes roll back, even on success.
begin;
do $$
declare
  test_device text := 'NOMST-V2-STAGING-COLLISION-TEST';
  collision_blocked boolean := false;
begin
  insert into public.nomst_v2_reservations(device_code,start_date,end_date,status)
  values(test_device, current_date + 60, current_date + 62, 'pending');

  begin
    insert into public.nomst_v2_reservations(device_code,start_date,end_date,status)
    values(test_device, current_date + 61, current_date + 64, 'confirmed');
  exception when exclusion_violation then
    collision_blocked := true;
  end;
  if not collision_blocked then
    raise exception 'FAIL: overlapping active reservations were accepted';
  end if;

  -- An adjacent interval is allowed.
  insert into public.nomst_v2_reservations(device_code,start_date,end_date,status)
  values(test_device, current_date + 63, current_date + 64, 'confirmed');

  -- Cancelled reservations do not block availability.
  insert into public.nomst_v2_reservations(device_code,start_date,end_date,status)
  values(test_device, current_date + 60, current_date + 62, 'cancelled');

  raise notice 'PASS: active overlap blocked; adjacent and cancelled intervals allowed';
end $$;
rollback;
