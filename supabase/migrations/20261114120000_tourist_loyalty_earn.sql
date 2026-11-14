-- Signed-in tourists earn cashback points when they book, and can see their own balance.
--
-- Points were switched off for every booking, and get_loyalty always answered 0, because a
-- phone number (typed in a form or saved in an editable profile) proves nothing about who
-- owns a balance. Points are now kept per account instead of per phone:
--   * book_departure credits site_settings.cashback_percent of the amount paid to the
--     signed-in tourist's own account (loyalty key 'user:<account id>'). Guests and staff
--     earn nothing. Spending points stays off.
--   * get_loyalty returns the caller's own account, whatever phone the page passes in.
--
-- This file deliberately has no grant or revoke lines: "create or replace" keeps the
-- execute rights the live database already has, and the site depends on them.

create or replace function public.loyalty_key(p_user uuid)
returns text
language sql
immutable
as $$
  select 'user:' || p_user::text
$$;

create or replace function public.get_loyalty(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_account public.loyalty_accounts%rowtype;
  v_history jsonb;
begin
  if auth.uid() is null then
    raise exception 'loyalty requires a verified account';
  end if;
  v_key := public.loyalty_key(auth.uid());
  select * into v_account from public.loyalty_accounts where phone = v_key;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'tourId', tour_id,
        'tourTitle', tour_title,
        'kind', kind,
        'points', points,
        'note', note,
        'createdAt', created_at
      )
      order by created_at desc
    ),
    '[]'::jsonb
  )
  into v_history
  from public.loyalty_ledger
  where phone = v_key;
  -- The phone is echoed back only so the page can file the balance under the number it asked for.
  return jsonb_build_object(
    'phone', regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'),
    'full_name', coalesce(v_account.full_name, ''),
    'points', coalesce(v_account.points, 0),
    'history', v_history
  );
end;
$$;

create or replace function public.book_departure(
  p_departure_id uuid,
  p_tour_id text,
  p_passenger_name text,
  p_phone text,
  p_adults integer,
  p_children integer,
  p_use_points boolean,
  p_provider text,
  p_idempotency_key text,
  p_guest_proof text,
  p_expected_date date,
  p_expected_price integer,
  p_expected_seats integer,
  p_expected_cashback integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_departure public.departures%rowtype;
  v_price integer;
  v_cashback integer;
  v_title text;
  v_departure_time text;
  v_starts_at timestamptz;
  v_seats integer;
  v_phone text;
  v_user uuid;
  v_role text;
  v_confirmation public.booking_confirmations%rowtype;
  v_booking public.bookings%rowtype;
  v_first integer;
  v_ticket text;
  v_numbers jsonb;
  v_attempt integer := 0;
  v_fingerprint text;
  v_proof_hash text;
  v_payable integer;
  v_result jsonb;
  v_loyalty_phone text;
  v_loyalty_name text;
  v_loyalty jsonb;
  v_earned integer := 0;
  v_points integer := 0;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,80}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Հաստատման բանալին սխալ է։');
  end if;
  if auth.uid() is null and (p_guest_proof is null or p_guest_proof !~ '^[A-Za-z0-9_-]{16,80}$') then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Հյուրի հաստատման ապացույցը սխալ է։');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));

  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_fingerprint := concat_ws(
    '|',
    p_departure_id::text,
    coalesce(p_adults, 0)::text,
    coalesce(p_children, 0)::text,
    v_phone,
    lower(trim(coalesce(p_passenger_name, ''))),
    case when coalesce(p_use_points, false) then '1' else '0' end
  );
  v_proof_hash := case when auth.uid() is null then md5(p_guest_proof) else '' end;

  select * into v_confirmation
  from public.booking_confirmations
  where idempotency_key = p_idempotency_key;

  if found then
    if v_confirmation.booker_id is distinct from auth.uid()
      or v_confirmation.guest_proof_hash is distinct from v_proof_hash
      or v_confirmation.order_fingerprint is distinct from v_fingerprint
      or v_confirmation.stored_result is null then
      return jsonb_build_object(
        'ok', false,
        'code', 'confirmation_mismatch',
        'message', 'Այս հաստատումը չի համընկնում պատվերի հետ։'
      );
    end if;
    return v_confirmation.stored_result || jsonb_build_object('repeated', true);
  end if;

  if coalesce(p_use_points, false) then
    return jsonb_build_object(
      'ok', false,
      'code', 'points_unverified',
      'message', 'Հեռախոսահամարը հաշվին հաստատված չէ. ամրագրեք առանց միավորների։'
    );
  end if;

  v_seats := coalesce(p_adults, 0) + coalesce(p_children, 0);
  if length(trim(coalesce(p_passenger_name, ''))) < 2
    or length(v_phone) < 8
    or p_adults is null or p_adults < 1
    or p_children is null or p_children < 0
    or v_seats < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Ամրագրման տվյալները թերի են։');
  end if;

  select * into v_departure
  from public.departures
  where id = p_departure_id
  for update;

  if not found or v_departure.tour_id is distinct from p_tour_id or v_departure.departure_date < current_date then
    return jsonb_build_object('ok', false, 'code', 'unavailable', 'message', 'Այս մեկնումը ամրագրման համար հասանելի չէ։');
  end if;

  select price, title, departure_time
  into v_price, v_title, v_departure_time
  from public.tours
  where id = v_departure.tour_id
  for share;

  v_price := coalesce(v_price, 0);
  select cashback_percent into v_cashback from public.site_settings where id = 1;
  v_cashback := coalesce(v_cashback, 0);

  v_departure_time := nullif(btrim(v_departure_time), '');
  if v_departure_time is null
    or v_departure_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    return jsonb_build_object(
      'ok', false,
      'code', 'closed',
      'message', 'Այս մեկնման ամրագրումն արդեն փակ է'
    );
  end if;
  v_starts_at := (v_departure.departure_date + v_departure_time::time) at time zone 'Asia/Yerevan';
  if clock_timestamp() >= v_starts_at then
    return jsonb_build_object(
      'ok', false,
      'code', 'closed',
      'message', 'Այս մեկնման ամրագրումն արդեն փակ է'
    );
  end if;

  if v_departure.departure_date is distinct from p_expected_date
    or v_price is distinct from p_expected_price
    or v_cashback is distinct from p_expected_cashback then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale',
      'message', 'Մեկնման տվյալները փոխվել են։ Ստուգեք և հաստատեք նորից։',
      'departure_date', v_departure.departure_date,
      'price', v_price,
      'available_seats', v_departure.available_seats,
      'cashback_percent', v_cashback
    );
  end if;

  if v_departure.available_seats < v_seats then
    return jsonb_build_object(
      'ok', false,
      'code', 'sold_out',
      'message', 'Ազատ տեղերը չեն բավարարում։',
      'departure_date', v_departure.departure_date,
      'price', v_price,
      'available_seats', v_departure.available_seats,
      'cashback_percent', v_cashback
    );
  end if;

  if v_departure.available_seats is distinct from p_expected_seats then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale',
      'message', 'Ազատ տեղերը փոխվել են։ Ստուգեք և հաստատեք նորից։',
      'departure_date', v_departure.departure_date,
      'price', v_price,
      'available_seats', v_departure.available_seats,
      'cashback_percent', v_cashback
    );
  end if;

  v_payable := v_price * v_seats;
  if v_payable > 0 and coalesce(p_provider, '') not in ('idram', 'telcell', 'arca') then
    return jsonb_build_object('ok', false, 'code', 'payment', 'message', 'Ընտրեք վճարման եղանակը։');
  end if;

  select role into v_role from public.profiles where id = auth.uid();
  if v_role = 'tourist' then
    v_user := auth.uid();
  end if;

  select coalesce(max(seat_number + seats_count - 1), 0) + 1 into v_first
  from public.bookings
  where departure_id = v_departure.id;
  select jsonb_agg(gs.seat_number order by gs.seat_number) into v_numbers
  from generate_series(v_first, v_first + v_seats - 1) as gs(seat_number);

  loop
    v_attempt := v_attempt + 1;
    v_ticket := 'AG-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
    begin
      insert into public.bookings (
        user_id, departure_id, tour_id, passenger_name, phone, seat_number, seats_count,
        ticket_code, status, adults, children, total_price, used_points, amount,
        payment_provider, payment_status, attendance
      ) values (
        v_user, v_departure.id, v_departure.tour_id, trim(p_passenger_name), trim(p_phone), v_first, v_seats,
        v_ticket, 'booked', p_adults, p_children, v_payable, 0, v_payable,
        case when v_payable > 0 then p_provider else null end,
        'SUCCESS',
        null
      )
      returning * into v_booking;
      exit;
    exception
      when unique_violation then
        if v_attempt >= 3 then
          raise;
        end if;
    end;
  end loop;

  update public.departures
  set available_seats = available_seats - v_seats
  where id = v_departure.id;

  -- Points go only to a signed-in tourist's own account, never to a phone number.
  if v_user is not null and v_payable > 0 and v_cashback > 0 then
    v_loyalty_phone := public.loyalty_key(v_user);
    select coalesce(nullif(trim(full_name), ''), trim(p_passenger_name))
    into v_loyalty_name
    from public.profiles
    where id = v_user;
    begin
      v_earned := floor(v_payable * v_cashback / 100.0)::integer;
      if v_earned > 0 then
        v_loyalty := public.apply_loyalty(
          v_loyalty_phone,
          v_loyalty_name,
          0,
          v_earned,
          v_departure.tour_id,
          coalesce(v_title, v_departure.tour_id),
          v_cashback
        );
        v_points := coalesce((v_loyalty ->> 'points')::integer, v_earned);
      end if;
    end;
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'repeated', false,
    'booking_id', v_booking.id,
    'ticket_code', v_booking.ticket_code,
    'seat_number', v_first,
    'seat_numbers', v_numbers,
    'seats_count', v_seats,
    'payable', v_payable,
    'redeemed', 0,
    'earned', v_earned,
    'points', v_points,
    'departure_date', v_departure.departure_date,
    'available_seats', v_departure.available_seats - v_seats
  );

  insert into public.booking_confirmations (
    idempotency_key, booking_id, booker_id, guest_proof_hash, order_fingerprint, stored_result
  ) values (
    p_idempotency_key, v_booking.id, auth.uid(), v_proof_hash, v_fingerprint, v_result
  );

  return v_result;
end;
$$;

