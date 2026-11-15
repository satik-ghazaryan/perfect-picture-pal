-- A tourist cancels their own booking 24+ hours ahead: seats, refund and points come back.
begin;
create temporary table ids (name text primary key, id uuid);
grant all on ids to authenticated;
set local role authenticated;
select set_config('test.uid', '11111111-1111-4111-8111-111111111111', true);
do $$
declare r jsonb;
begin
  r := public.book_departure('b3f34215-fe83-4766-ac5f-7e484db26655', 'dil', 'Զբոսաշրջիկ', '+374 94 369900', 2, 0, false, 'idram',
    'cancelkey000000000001', 'cancelproof0000000001', current_date + 10, 8000, 11, 5);
  assert (r->>'ok')::boolean, 'booking failed: ' || r::text;
  insert into ids values ('mine', (r->>'booking_id')::uuid);
end
$$;
reset role;
do $$
begin
  assert (select available_seats from public.departures where id = 'b3f34215-fe83-4766-ac5f-7e484db26655') = 9, 'seats not taken';
  assert (select points from public.loyalty_accounts where phone = public.loyalty_key('11111111-1111-4111-8111-111111111111')) = 800, 'cashback not earned';
end
$$;
-- another tourist's booking cannot be cancelled by a guide or anonymous visitor
set local role authenticated;
select set_config('test.uid', '22222222-2222-4222-8222-222222222222', true);
do $$
begin
  assert public.cancel_my_booking((select id from ids where name = 'mine'))->>'code' = 'signin', 'guide cancelled a booking';
end
$$;
select set_config('test.uid', '11111111-1111-4111-8111-111111111111', true);
do $$
declare r jsonb;
begin
  r := public.cancel_my_booking((select id from ids where name = 'mine'));
  assert (r->>'ok')::boolean and (r->>'refund')::int = 16000 and (r->>'seats_released')::int = 2, 'cancel failed: ' || r::text;
  assert (r->>'points_removed')::int = 800, 'cashback not taken back: ' || r::text;
  assert (public.cancel_my_booking((select id from ids where name = 'mine'))->>'already')::boolean, 'second cancel not recognised';
end
$$;
reset role;
do $$
begin
  assert (select available_seats from public.departures where id = 'b3f34215-fe83-4766-ac5f-7e484db26655') = 11, 'seats not returned';
  assert (select status from public.bookings where id = (select id from ids where name = 'mine')) = 'cancelled', 'status not cancelled';
  assert (select payment_status from public.bookings where id = (select id from ids where name = 'mine')) = 'REFUNDED', 'not marked refunded';
  assert (select points from public.loyalty_accounts where phone = public.loyalty_key('11111111-1111-4111-8111-111111111111')) = 0, 'balance wrong';
end
$$;
rollback;
begin;
-- Less than 24 hours before departure the booking stays.
set local role authenticated;
select set_config('test.uid', '11111111-1111-4111-8111-111111111111', true);
create temporary table late (id uuid);
do $$
declare r jsonb;
begin
  r := public.book_departure('b3f34215-fe83-4766-ac5f-7e484db26655', 'dil', 'Զբոսաշրջիկ', '+374 94 369900', 1, 0, false, 'idram',
    'cancelkey000000000002', 'cancelproof0000000001', current_date + 10, 8000, 11, 5);
  insert into late values ((r->>'booking_id')::uuid);
end
$$;
reset role;
update public.departures set departure_date = (now() at time zone 'Asia/Yerevan' + interval '12 hours')::date where id = 'b3f34215-fe83-4766-ac5f-7e484db26655';
update public.tours set departure_time = to_char((now() at time zone 'Asia/Yerevan') + interval '12 hours', 'HH24:MI') where id = 'dil';
set local role authenticated;
select set_config('test.uid', '11111111-1111-4111-8111-111111111111', true);
do $$
begin
  assert public.cancel_my_booking((select id from late))->>'code' = 'too_late', 'late cancel allowed';
end
$$;
rollback;
