-- A signed-in tourist can cancel their own booking up to 24 hours before departure.
--
--   * The seats go back to the departure, so the tour page shows them as free again.
--   * Paid money is marked for refund (payment_status 'REFUNDED'). Payments run in sandbox
--     mode, so no money moves yet; the real refund is wired in with the payment provider.
--   * Points spent on the booking come back; cashback earned on it is taken back.
--   * Less than 24 hours before departure, or after check-in, cancelling is refused.

alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings
  add constraint bookings_status_check check (status in ('booked', 'checked_in', 'cancelled'));

-- The booking guard lets non-admins change only attendance. Two narrow exceptions, each only
-- inside its own function: linking a guest booking (user_id from empty to set) and cancelling
-- (status, payment status and attendance).
create or replace function public.protect_booking_staff_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if current_setting('ari.linking_guest_booking', true) = 'on'
    and old.user_id is null
    and new.user_id is not null
    and (to_jsonb(new) - 'user_id') is not distinct from (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  if current_setting('ari.cancelling_booking', true) = 'on'
    and old.status <> 'cancelled'
    and new.status = 'cancelled'
    and (to_jsonb(new) - 'status' - 'payment_status' - 'attendance')
      is not distinct from (to_jsonb(old) - 'status' - 'payment_status' - 'attendance') then
    return new;
  end if;
  if (to_jsonb(new) - 'attendance') is distinct from (to_jsonb(old) - 'attendance') then
    raise exception 'staff may only update attendance';
  end if;
  return new;
end;
$$;

create or replace function public.cancel_my_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_departure public.departures%rowtype;
  v_time text;
  v_title text;
  v_starts_at timestamptz;
  v_key text;
  v_earned integer := 0;
  v_returned integer := 0;
  v_balance integer;
  v_refund integer := 0;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'tourist'
  ) then
    return jsonb_build_object('ok', false, 'code', 'signin', 'message', 'Մուտք գործեք ձեր հաշիվ։');
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.user_id is distinct from v_user then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Ամրագրումը չգտնվեց։');
  end if;
  if v_booking.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_booking.status <> 'booked' or v_booking.attendance is not null then
    return jsonb_build_object('ok', false, 'code', 'checked_in', 'message', 'Գրանցված ամրագրումը հնարավոր չէ չեղարկել։');
  end if;

  select * into v_departure from public.departures where id = v_booking.departure_id for update;
  select departure_time, title into v_time, v_title from public.tours where id = v_booking.tour_id;
  v_time := nullif(btrim(v_time), '');
  if v_departure.id is null
    or v_time is null
    or v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    return jsonb_build_object('ok', false, 'code', 'unavailable', 'message', 'Այս ամրագրումը հնարավոր չէ չեղարկել կայքում։ Կապվեք մեզ հետ։');
  end if;
  v_starts_at := (v_departure.departure_date + v_time::time) at time zone 'Asia/Yerevan';
  if clock_timestamp() > v_starts_at - interval '24 hours' then
    return jsonb_build_object(
      'ok', false,
      'code', 'too_late',
      'message', 'Չեղարկումը հնարավոր է մինչև մեկնումից 24 ժամ առաջ։'
    );
  end if;

  if v_booking.payment_status = 'SUCCESS' and coalesce(v_booking.amount, 0) > 0 then
    v_refund := v_booking.amount;
  end if;

  perform set_config('ari.cancelling_booking', 'on', true);
  update public.bookings
  set status = 'cancelled',
      payment_status = case when v_refund > 0 then 'REFUNDED' else payment_status end,
      attendance = null
  where id = v_booking.id;
  perform set_config('ari.cancelling_booking', 'off', true);

  update public.departures
  set available_seats = available_seats + greatest(coalesce(v_booking.seats_count, 1), 1)
  where id = v_departure.id;

  -- Points: spent ones come back, cashback earned on this booking is taken back.
  select coalesce((stored_result ->> 'earned')::integer, 0) into v_earned
  from public.booking_confirmations
  where booking_id = v_booking.id
  limit 1;
  v_earned := coalesce(v_earned, 0);
  v_returned := coalesce(v_booking.used_points, 0);
  if v_returned > 0 or v_earned > 0 then
    v_key := public.loyalty_key(v_user);
    select points into v_balance from public.loyalty_accounts where phone = v_key for update;
    if found then
      update public.loyalty_accounts
      set points = greatest(points + v_returned - v_earned, 0)
      where phone = v_key
      returning points into v_balance;
      if v_returned > 0 then
        insert into public.loyalty_ledger (phone, tour_id, tour_title, kind, points, note)
        values (v_key, v_booking.tour_id, coalesce(v_title, v_booking.tour_id), 'earn', v_returned,
          'Չեղարկված ամրագրման միավորների վերադարձ');
      end if;
      if v_earned > 0 then
        insert into public.loyalty_ledger (phone, tour_id, tour_title, kind, points, note)
        values (v_key, v_booking.tour_id, coalesce(v_title, v_booking.tour_id), 'redeem', v_earned,
          'Չեղարկված ամրագրման հետվճարը հանվեց');
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'ticket_code', v_booking.ticket_code,
    'refund', v_refund,
    'points_returned', v_returned,
    'points_removed', v_earned,
    'seats_released', greatest(coalesce(v_booking.seats_count, 1), 1)
  );
end;
$$;

revoke all on function public.cancel_my_booking(uuid) from public, anon;
grant execute on function public.cancel_my_booking(uuid) to authenticated;
