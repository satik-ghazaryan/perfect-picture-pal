-- One tourist, one guide, one tour with a departure in ten days.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'tourist@example.am'),
  ('22222222-2222-4222-8222-222222222222', 'guide@example.am')
on conflict do nothing;
insert into public.profiles (id, full_name, role) values
  ('11111111-1111-4111-8111-111111111111', 'Զբոսաշրջիկ', 'tourist'),
  ('22222222-2222-4222-8222-222222222222', 'Զբոսավար', 'guide')
on conflict (id) do nothing;
update public.profiles set role = 'tourist', phone = '+374 94 369900' where id = '11111111-1111-4111-8111-111111111111';
update public.profiles set role = 'guide' where id = '22222222-2222-4222-8222-222222222222';
insert into public.tours (id, title, title_hy, departure_place, departure_time, price)
values ('dil', 'Dilijan', 'Դիլիջան', 'Արմավիր', '08:00', 8000)
on conflict (id) do update set price = 8000, departure_time = '08:00';
insert into public.departures (id, tour_id, departure_date, available_seats)
values ('b3f34215-fe83-4766-ac5f-7e484db26655', 'dil', current_date + 10, 11)
on conflict (id) do update set departure_date = current_date + 10, available_seats = 11;
-- The live project lets the website call book_departure directly.
grant execute on function public.book_departure(uuid, text, text, text, integer, integer, boolean, text, text, text, date, integer, integer, integer) to anon, authenticated;
