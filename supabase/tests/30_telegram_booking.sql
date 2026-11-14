-- Booking from the Telegram bot: only the backend may call it, and it is idempotent.
begin;
set local role anon;
do $$
begin
  perform public.book_departure_telegram('b3f34215-fe83-4766-ac5f-7e484db26655', 42, 'Tg', '+37494111111', 1, 0, 'tgkey00000000000001', 8000);
  raise exception 'anon was able to book through the Telegram function';
exception when insufficient_privilege then null;
end
$$;
reset role;
set local role service_role;
do $$
declare r jsonb;
begin
  r := public.book_departure_telegram('b3f34215-fe83-4766-ac5f-7e484db26655', 42, 'Tg User', '+37494111111', 2, 1, 'tgkey00000000000001', 8000);
  assert (r->>'ok')::boolean and (r->>'payable')::int = 24000 and r->>'payment_status' = 'PENDING', 'booking failed: ' || r::text;
  assert (public.book_departure_telegram('b3f34215-fe83-4766-ac5f-7e484db26655', 42, 'Tg User', '+37494111111', 2, 1, 'tgkey00000000000001', 8000)->>'repeated')::boolean, 'repeat not recognised';
  assert public.book_departure_telegram('b3f34215-fe83-4766-ac5f-7e484db26655', 43, 'Tg User', '+37494111111', 2, 1, 'tgkey00000000000001', 8000)->>'code' = 'confirmation_mismatch', 'another chat reused the key';
  assert public.book_departure_telegram('b3f34215-fe83-4766-ac5f-7e484db26655', 42, 'Tg User', '+37494111111', 9, 0, 'tgkey00000000000002', 8000)->>'code' = 'sold_out', 'oversold';
  assert public.book_departure_telegram('b3f34215-fe83-4766-ac5f-7e484db26655', 42, 'Tg User', '+37494111111', 1, 0, 'tgkey00000000000003', 7000)->>'code' = 'stale', 'old price accepted';
end
$$;
reset role;
do $$
begin
  assert (select available_seats from public.departures where id = 'b3f34215-fe83-4766-ac5f-7e484db26655') = 8, 'seats not reserved';
end
$$;
rollback;
