-- Spending and earning loyalty points when a signed-in tourist books.
begin;
select set_config('test.uid', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
do $$
declare r jsonb; again jsonb; full_cover jsonb; guest jsonb;
begin
  -- No points yet: nothing is redeemed, cashback is earned on the paid amount.
  r := public.book_departure('b3f34215-fe83-4766-ac5f-7e484db26655', 'dil', 'Զբոսաշրջիկ', '+374 94 369900', 1, 0, true, 'idram',
    'pointskey000000000001', 'pointsproof00000000001', (current_date + 10), 8000, 11, 5);
  assert (r->>'ok')::boolean, 'first booking failed: ' || r::text;
  assert (r->>'redeemed')::int = 0 and (r->>'payable')::int = 8000, 'nothing to redeem yet: ' || r::text;
  assert (r->>'earned')::int = 400, 'expected 5% cashback: ' || r::text;

  -- The same confirmation again is not a second booking.
  again := public.book_departure('b3f34215-fe83-4766-ac5f-7e484db26655', 'dil', 'Զբոսաշրջիկ', '+374 94 369900', 1, 0, true, 'idram',
    'pointskey000000000001', 'pointsproof00000000001', (current_date + 10), 8000, 11, 5);
  assert (again->>'repeated')::boolean, 'repeat was not recognised';

  -- 400 points are spent on the next seat; cashback only on the 7600 paid.
  r := public.book_departure('b3f34215-fe83-4766-ac5f-7e484db26655', 'dil', 'Զբոսաշրջիկ', '+374 94 369900', 1, 0, true, 'idram',
    'pointskey000000000002', 'pointsproof00000000001', (current_date + 10), 8000, 10, 5);
  assert (r->>'redeemed')::int = 400 and (r->>'payable')::int = 7600, 'redeem failed: ' || r::text;
  assert (r->>'earned')::int = 380 and (r->>'points')::int = 380, 'balance wrong: ' || r::text;

  -- A guest cannot use points.
  perform set_config('test.uid', '', true);
  guest := public.book_departure('b3f34215-fe83-4766-ac5f-7e484db26655', 'dil', 'Հյուր', '+374 94 000000', 1, 0, true, 'idram',
    'pointskey000000000003', 'pointsproof00000000003', (current_date + 10), 8000, 9, 5);
  assert guest->>'code' = 'points_signin', 'guest used points: ' || guest::text;
end
$$;
reset role;
do $$
begin
  assert (select points from public.loyalty_accounts where phone = public.loyalty_key('11111111-1111-4111-8111-111111111111')) = 380, 'stored balance wrong';
  assert (select available_seats from public.departures where id = 'b3f34215-fe83-4766-ac5f-7e484db26655') = 9, 'seats not reserved';
  -- Points covering the whole price need no payment method.
  update public.loyalty_accounts set points = 20000 where phone = public.loyalty_key('11111111-1111-4111-8111-111111111111');
end
$$;
set local role authenticated;
select set_config('test.uid', '11111111-1111-4111-8111-111111111111', true);
do $$
declare r jsonb;
begin
  r := public.book_departure('b3f34215-fe83-4766-ac5f-7e484db26655', 'dil', 'Զբոսաշրջիկ', '+374 94 369900', 1, 0, true, null,
    'pointskey000000000004', 'pointsproof00000000001', (current_date + 10), 8000, 9, 5);
  assert (r->>'ok')::boolean and (r->>'payable')::int = 0 and (r->>'redeemed')::int = 8000, 'full cover failed: ' || r::text;
end
$$;
rollback;
