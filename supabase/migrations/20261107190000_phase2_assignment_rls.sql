-- Departure assignments and passenger lists follow the current departure,
-- not the old tour-level guide or driver.

drop policy if exists "staff update assigned departures" on public.departures;

drop policy if exists "staff read tour bookings" on public.bookings;
drop policy if exists "staff check in passengers" on public.bookings;

drop policy if exists "staff read assigned bookings" on public.bookings;
create policy "staff read assigned bookings"
  on public.bookings for select
  to authenticated
  using (
    exists (
      select 1
      from public.departures
      join public.profiles on profiles.id = auth.uid()
      where departures.id = bookings.departure_id
        and (
          (departures.guide_id = auth.uid() and profiles.role = 'guide')
          or (departures.driver_id = auth.uid() and profiles.role = 'driver')
        )
    )
  );

drop policy if exists "guides update attendance" on public.bookings;
create policy "guides update attendance"
  on public.bookings for update
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.departures
      join public.profiles on profiles.id = auth.uid()
      where departures.id = bookings.departure_id
        and departures.guide_id = auth.uid()
        and profiles.role = 'guide'
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1
      from public.departures
      join public.profiles on profiles.id = auth.uid()
      where departures.id = bookings.departure_id
        and departures.guide_id = auth.uid()
        and profiles.role = 'guide'
    )
  );

create or replace function public.protect_booking_staff_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if (to_jsonb(new) - 'attendance') is distinct from (to_jsonb(old) - 'attendance') then
    raise exception 'staff may only update attendance';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_booking_staff_columns on public.bookings;
create trigger protect_booking_staff_columns
  before update on public.bookings
  for each row
  execute function public.protect_booking_staff_columns();
