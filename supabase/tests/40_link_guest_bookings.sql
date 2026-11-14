-- Guest bookings join an account only with proof: the device secret or code + phone.
begin;
create temporary table codes (name text primary key, code text);
grant all on codes to anon, authenticated;
set local role anon;
select set_config('test.uid', '', true);
do $$
begin
  insert into codes values ('own', public.book_departure('b3f34215-fe83-4766-ac5f-7e484db26655', 'dil', 'Հյուր', '094 369900', 1, 0, false, 'idram',
    'claimkey00000000000001', 'guestsecret000000000001', (current_date + 10), 8000, 11, 5)->>'ticket_code');
  insert into codes values ('other', public.book_departure('b3f34215-fe83-4766-ac5f-7e484db26655', 'dil', 'Ուրիշ', '+374 77 111222', 1, 0, false, 'idram',
    'claimkey00000000000002', 'guestsecret000000000002', (current_date + 10), 8000, 10, 5)->>'ticket_code');
  begin
    perform public.claim_guest_booking((select code from codes where name = 'own'), '094369900');
    raise exception 'a guest was able to claim';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
set local role authenticated;
select set_config('test.uid', '11111111-1111-4111-8111-111111111111', true);
do $$
declare r jsonb; other text := (select code from codes where name = 'other');
begin
  r := public.claim_guest_bookings_by_proof('[
    {"key":"claimkey00000000000001","proof":"wrongsecret000000000001"},
    {"key":"claimkey00000000000001","proof":"guestsecret000000000001"},
    {"key":"claimkey00000000000002","proof":"guestsecret000000000002"}]');
  assert jsonb_array_length(r->'linked') = 1 and r->'linked'->>0 = (select code from codes where name = 'own'), 'proof link wrong: ' || r::text;
  assert not (r->'done') ? 'claimkey00000000000002', 'a booking with another phone was finished: ' || r::text;
  assert public.claim_guest_booking(other, '+374 77 999999')->>'code' = 'not_found', 'wrong phone linked';
  assert (public.claim_guest_booking(lower(other), '077 111222')->>'linked')::int = 1, 'code and phone did not link';
  assert (public.claim_guest_booking(other, '077 111222')->>'already')::boolean, 'second link not recognised';
  perform set_config('test.uid', '22222222-2222-4222-8222-222222222222', true);
  assert public.claim_guest_booking(other, '077 111222')->>'code' = 'signin', 'a guide linked a booking';
end
$$;
reset role;
do $$
begin
  assert (select count(*) from public.bookings where ticket_code in (select code from codes) and user_id = '11111111-1111-4111-8111-111111111111') = 2, 'not linked to the tourist';
end
$$;
rollback;
