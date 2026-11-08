-- Hide unconfirmed departure links from staff until an admin confirms them.
-- Those rows do not change the stored free-seat count.

create or replace function public.booking_link_needs_review(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.booking_departure_conflicts
    where booking_id = p_booking_id
      and reason = 'Նոր հոսքով չի ստեղծվել և ամրագրման սեփական ամսաթիվ չկա. կապը մնացել է ձեռքով վերանայման։'
  );
$$;

revoke all on function public.booking_link_needs_review(uuid) from public, anon;
grant execute on function public.booking_link_needs_review(uuid) to authenticated;

drop policy if exists "staff read assigned bookings" on public.bookings;
create policy "staff read assigned bookings"
  on public.bookings for select
  to authenticated
  using (
    not public.booking_link_needs_review(bookings.id)
    and exists (
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
    or (
      not public.booking_link_needs_review(bookings.id)
      and exists (
        select 1
        from public.departures
        join public.profiles on profiles.id = auth.uid()
        where departures.id = bookings.departure_id
          and departures.guide_id = auth.uid()
          and profiles.role = 'guide'
      )
    )
  )
  with check (
    public.is_admin()
    or (
      not public.booking_link_needs_review(bookings.id)
      and exists (
        select 1
        from public.departures
        join public.profiles on profiles.id = auth.uid()
        where departures.id = bookings.departure_id
          and departures.guide_id = auth.uid()
          and profiles.role = 'guide'
      )
    )
  );

create or replace function public.confirm_booking_departure(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_departure public.departures%rowtype;
  v_seats integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'message', 'Միայն ադմինը կարող է հաստատել մեկնումը։');
  end if;
  if not public.booking_link_needs_review(p_booking_id) then
    return jsonb_build_object('ok', true, 'repeated', true, 'message', 'Այս կապն արդեն հաստատված է։');
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.departure_id is null then
    return jsonb_build_object('ok', false, 'message', 'Մեկնումը միանշանակ չէ։');
  end if;

  select * into v_departure from public.departures where id = v_booking.departure_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Մեկնումը չի գտնվել։');
  end if;

  v_seats := greatest(coalesce(v_booking.seats_count, 1), 1);
  if v_departure.available_seats < v_seats then
    return jsonb_build_object(
      'ok', false,
      'message', 'Ազատ տեղերը չեն բավարարում այս կապը հաստատելու համար։ Տեղերի հաշվարկը չի փոխվել։'
    );
  end if;

  update public.departures
  set available_seats = available_seats - v_seats
  where id = v_departure.id;

  delete from public.booking_departure_conflicts
  where booking_id = v_booking.id
    and reason = 'Նոր հոսքով չի ստեղծվել և ամրագրման սեփական ամսաթիվ չկա. կապը մնացել է ձեռքով վերանայման։';

  return jsonb_build_object('ok', true, 'repeated', false, 'available_seats', v_departure.available_seats - v_seats);
end;
$$;

revoke all on function public.confirm_booking_departure(uuid) from public, anon;
grant execute on function public.confirm_booking_departure(uuid) to authenticated;
