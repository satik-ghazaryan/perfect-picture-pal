-- Guide and driver portal: profiles, assigned tours, bookings, albums.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  role text not null default 'customer' check (role in ('guide', 'driver', 'customer'))
);

create table if not exists public.tours (
  id text primary key,
  title text not null,
  departure_place text not null,
  departure_time text not null,
  departure_date date not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed')),
  guide_id uuid references public.profiles (id),
  driver_id uuid references public.profiles (id)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  tour_id text not null references public.tours (id) on delete cascade,
  passenger_name text not null,
  phone text not null,
  seat_number integer not null check (seat_number > 0),
  ticket_code text not null unique,
  status text not null default 'booked' check (status in ('booked', 'checked_in')),
  adults integer not null default 1 check (adults >= 0),
  children integer not null default 0 check (children >= 0),
  checked_in_at timestamptz
);

create table if not exists public.tour_photos (
  id uuid primary key default gen_random_uuid(),
  tour_id text not null references public.tours (id) on delete cascade,
  url text not null,
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists bookings_tour_id_idx on public.bookings (tour_id);

create or replace function public.create_booking(
  p_tour_id text,
  p_passenger_name text,
  p_phone text,
  p_ticket_code text,
  p_adults integer,
  p_children integer
) returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  next_seat integer;
  created public.bookings;
begin
  if length(trim(p_passenger_name)) < 2 or length(trim(p_phone)) < 8 then
    raise exception 'Invalid passenger details';
  end if;
  select coalesce(max(seat_number), 0) + 1 into next_seat
  from public.bookings
  where tour_id = p_tour_id;
  insert into public.bookings (
    tour_id, passenger_name, phone, seat_number, ticket_code, status, adults, children
  ) values (
    p_tour_id, trim(p_passenger_name), trim(p_phone), next_seat, upper(trim(p_ticket_code)), 'booked', p_adults, p_children
  )
  returning * into created;
  return created;
end;
$$;

grant execute on function public.create_booking(text, text, text, text, integer, integer) to anon, authenticated;
create index if not exists tour_photos_tour_id_idx on public.tour_photos (tour_id);

alter table public.profiles enable row level security;
alter table public.tours enable row level security;
alter table public.bookings enable row level security;
alter table public.tour_photos enable row level security;

create policy "staff read own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "staff read assigned tours"
  on public.tours for select
  to authenticated
  using (guide_id = auth.uid() or driver_id = auth.uid());

create policy "staff update assigned tours"
  on public.tours for update
  to authenticated
  using (guide_id = auth.uid() or driver_id = auth.uid())
  with check (guide_id = auth.uid() or driver_id = auth.uid());

create policy "public can book a seat"
  on public.bookings for insert
  to anon, authenticated
  with check (status = 'booked');

create policy "staff read tour bookings"
  on public.bookings for select
  to authenticated
  using (
    exists (
      select 1 from public.tours
      where tours.id = bookings.tour_id
        and (tours.guide_id = auth.uid() or tours.driver_id = auth.uid())
    )
  );

create policy "staff check in passengers"
  on public.bookings for update
  to authenticated
  using (
    exists (
      select 1 from public.tours
      where tours.id = bookings.tour_id
        and (tours.guide_id = auth.uid() or tours.driver_id = auth.uid())
    )
  )
  with check (status in ('booked', 'checked_in'));

create policy "staff read tour photos"
  on public.tour_photos for select
  to authenticated
  using (
    exists (
      select 1 from public.tours
      where tours.id = tour_photos.tour_id
        and (tours.guide_id = auth.uid() or tours.driver_id = auth.uid())
    )
  );

create policy "staff add tour photos"
  on public.tour_photos for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.tours
      where tours.id = tour_photos.tour_id
        and (tours.guide_id = auth.uid() or tours.driver_id = auth.uid())
    )
  );

insert into storage.buckets (id, name, public)
values ('tour-albums', 'tour-albums', true)
on conflict (id) do nothing;

create policy "public read tour albums"
  on storage.objects for select
  to public
  using (bucket_id = 'tour-albums');

create policy "staff upload tour albums"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'tour-albums');

insert into public.tours (id, title, departure_place, departure_time, departure_date)
values
  ('garni', 'Արմավիր – Գառնի, Գեղարդ և Քարերի Սիմֆոնիա', 'Արմավիր քաղաք, Կենտրոնական հրապարակ', '08:30', current_date),
  ('sevan', 'Արմավիր – Սևանա լիճ, Դիլիջան և Հաղարծին', 'Արմավիր քաղաք, Կենտրոնական հրապարակ', '08:00', current_date),
  ('tatev', 'Արմավիր – Տաթևի վանք և Տաթևեր ճոպանուղի', 'Արմավիր քաղաք, Կենտրոնական հրապարակ', '07:00', current_date)
on conflict (id) do nothing;

-- After a guide or driver signs up, assign them:
-- update public.profiles set role = 'guide' where id = '<user-uuid>';
-- update public.tours set guide_id = '<user-uuid>' where id = 'garni';
