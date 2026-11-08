-- Confirm a reviewed departure link once, even if two admins submit together.

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

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found or v_booking.departure_id is null then
    return jsonb_build_object('ok', false, 'message', 'Մեկնումը միանշանակ չէ։');
  end if;

  if not public.booking_link_needs_review(p_booking_id) then
    return jsonb_build_object('ok', true, 'repeated', true, 'message', 'Այս կապն արդեն հաստատված է։');
  end if;

  select * into v_departure
  from public.departures
  where id = v_booking.departure_id
  for update;

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

  return jsonb_build_object(
    'ok', true,
    'repeated', false,
    'seats', v_seats,
    'available_seats', v_departure.available_seats - v_seats
  );
end;
$$;

revoke all on function public.confirm_booking_departure(uuid) from public, anon;
grant execute on function public.confirm_booking_departure(uuid) to authenticated;
