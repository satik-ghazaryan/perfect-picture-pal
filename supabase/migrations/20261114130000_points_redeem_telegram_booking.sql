-- Spending loyalty points, and booking from the Telegram bot.
--
--   * book_departure: a signed-in tourist can spend points from their own account
--     (1 point = 1 AMD, up to the full price). The rest is paid; cashback is earned on
--     the paid part only. Guests still cannot use points.
--   * book_departure_telegram: the bot books a seat for a Telegram chat. Only the backend
--     (service role) can call it. The booking is saved with payment "PENDING"; nothing is
--     charged.
--   * telegram_chats.booking keeps the bot's half-finished booking between messages.
--
-- No grant or revoke lines for book_departure: "create or replace" keeps the live grants.

-- The chat table is created here too, in case the earlier Telegram migration was not run.
create table if not exists public.telegram_chats (
  chat_id bigint primary key,
  history jsonb not null default '[]'::jsonb,
  selected text,
  choices jsonb not null default '[]'::jsonb,
  updated_at timestamp with time zone not null default now()
);
alter table public.telegram_chats enable row level security;
revoke all on public.telegram_chats from public, anon, authenticated;
grant select, insert, update, delete on public.telegram_chats to service_role;
create index if not exists telegram_chats_updated_at_idx on public.telegram_chats (updated_at);

alter table public.telegram_chats add column if not exists booking jsonb;

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
  v_total integer;
  v_redeem integer := 0;
  v_balance integer;
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

  select role into v_role from public.profiles where id = auth.uid();
  if v_role = 'tourist' then
    v_user := auth.uid();
  end if;

  -- Points can be spent only from the signed-in tourist's own account (1 point = 1 AMD).
  -- The balance row is locked so two bookings at once cannot spend the same points.
  v_total := v_price * v_seats;
  if coalesce(p_use_points, false) then
    if v_user is null then
      return jsonb_build_object(
        'ok', false,
        'code', 'points_signin',
        'message', 'Միավորներ օգտագործելու համար մուտք գործեք ձեր հաշիվ։'
      );
    end if;
    v_loyalty_phone := public.loyalty_key(v_user);
    select points into v_balance
    from public.loyalty_accounts
    where phone = v_loyalty_phone
    for update;
    v_redeem := least(greatest(coalesce(v_balance, 0), 0), v_total);
  end if;
  v_payable := v_total - v_redeem;

  if v_payable > 0 and coalesce(p_provider, '') not in ('idram', 'telcell', 'arca') then
    return jsonb_build_object('ok', false, 'code', 'payment', 'message', 'Ընտրեք վճարման եղանակը։');
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
        v_ticket, 'booked', p_adults, p_children, v_total, v_redeem, v_payable,
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

  -- Points move only on a signed-in tourist's own account, never on a phone number.
  -- Cashback is earned on the money actually paid, not on the part covered by points.
  if v_user is not null then
    if v_payable > 0 and v_cashback > 0 then
      v_earned := floor(v_payable * v_cashback / 100.0)::integer;
    end if;
    if v_redeem > 0 or v_earned > 0 then
      v_loyalty_phone := public.loyalty_key(v_user);
      select coalesce(nullif(trim(full_name), ''), trim(p_passenger_name))
      into v_loyalty_name
      from public.profiles
      where id = v_user;
      v_loyalty := public.apply_loyalty(
        v_loyalty_phone,
        v_loyalty_name,
        v_redeem,
        v_earned,
        v_departure.tour_id,
        coalesce(v_title, v_departure.tour_id),
        v_cashback
      );
      v_points := coalesce((v_loyalty ->> 'points')::integer, 0);
    end if;
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'repeated', false,
    'booking_id', v_booking.id,
    'ticket_code', v_booking.ticket_code,
    'seat_number', v_first,
    'seat_numbers', v_numbers,
    'seats_count', v_seats,
    'total', v_total,
    'payable', v_payable,
    'redeemed', v_redeem,
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

create or replace function public.book_departure_telegram(
  p_departure_id uuid,
  p_chat_id bigint,
  p_passenger_name text,
  p_phone text,
  p_adults integer,
  p_children integer,
  p_request_key text,
  p_expected_price integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_departure public.departures%rowtype;
  v_confirmation public.booking_confirmations%rowtype;
  v_booking public.bookings%rowtype;
  v_price integer;
  v_title text;
  v_departure_time text;
  v_starts_at timestamptz;
  v_seats integer;
  v_phone text;
  v_first integer;
  v_ticket text;
  v_numbers jsonb;
  v_attempt integer := 0;
  v_fingerprint text;
  v_proof_hash text;
  v_total integer;
  v_result jsonb;
begin
  if p_chat_id is null or p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{16,80}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Հարցումը սխալ է։');
  end if;
  v_key := 'tg-' || p_request_key;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_fingerprint := concat_ws(
    '|',
    p_departure_id::text,
    coalesce(p_adults, 0)::text,
    coalesce(p_children, 0)::text,
    v_phone,
    lower(trim(coalesce(p_passenger_name, ''))),
    'telegram'
  );
  v_proof_hash := md5('telegram:' || p_chat_id::text);

  select * into v_confirmation
  from public.booking_confirmations
  where idempotency_key = v_key;
  if found then
    if v_confirmation.booker_id is not null
      or v_confirmation.guest_proof_hash is distinct from v_proof_hash
      or v_confirmation.order_fingerprint is distinct from v_fingerprint
      or v_confirmation.stored_result is null then
      return jsonb_build_object('ok', false, 'code', 'confirmation_mismatch', 'message', 'Այս հաստատումը չի համընկնում պատվերի հետ։');
    end if;
    return v_confirmation.stored_result || jsonb_build_object('repeated', true);
  end if;

  v_seats := coalesce(p_adults, 0) + coalesce(p_children, 0);
  if length(trim(coalesce(p_passenger_name, ''))) < 2
    or length(v_phone) < 8
    or p_adults is null or p_adults < 1
    or p_children is null or p_children < 0
    or v_seats < 1 or v_seats > 20 then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Ամրագրման տվյալները թերի են։');
  end if;

  select * into v_departure
  from public.departures
  where id = p_departure_id
  for update;
  if not found or v_departure.departure_date < current_date then
    return jsonb_build_object('ok', false, 'code', 'unavailable', 'message', 'Այս մեկնումը ամրագրման համար հասանելի չէ։');
  end if;

  select price, title, departure_time
  into v_price, v_title, v_departure_time
  from public.tours
  where id = v_departure.tour_id
  for share;
  v_price := coalesce(v_price, 0);

  v_departure_time := nullif(btrim(v_departure_time), '');
  if v_departure_time is null
    or v_departure_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    return jsonb_build_object('ok', false, 'code', 'closed', 'message', 'Այս մեկնման ամրագրումն արդեն փակ է');
  end if;
  v_starts_at := (v_departure.departure_date + v_departure_time::time) at time zone 'Asia/Yerevan';
  if clock_timestamp() >= v_starts_at then
    return jsonb_build_object('ok', false, 'code', 'closed', 'message', 'Այս մեկնման ամրագրումն արդեն փակ է');
  end if;

  if v_price is distinct from p_expected_price then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale',
      'message', 'Տուրի գինը փոխվել է։',
      'price', v_price,
      'available_seats', v_departure.available_seats
    );
  end if;
  if v_departure.available_seats < v_seats then
    return jsonb_build_object(
      'ok', false,
      'code', 'sold_out',
      'message', 'Ազատ տեղերը չեն բավարարում։',
      'price', v_price,
      'available_seats', v_departure.available_seats
    );
  end if;

  v_total := v_price * v_seats;

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
        null, v_departure.id, v_departure.tour_id, trim(p_passenger_name), trim(p_phone), v_first, v_seats,
        v_ticket, 'booked', p_adults, p_children, v_total, 0, v_total,
        null,
        case when v_total > 0 then 'PENDING' else 'SUCCESS' end,
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

  v_result := jsonb_build_object(
    'ok', true,
    'repeated', false,
    'booking_id', v_booking.id,
    'ticket_code', v_booking.ticket_code,
    'seat_numbers', v_numbers,
    'seats_count', v_seats,
    'payable', v_total,
    'payment_status', v_booking.payment_status,
    'tour_id', v_departure.tour_id,
    'tour_title', coalesce(v_title, v_departure.tour_id),
    'departure_date', v_departure.departure_date,
    'departure_time', left(v_departure_time, 5)
  );

  insert into public.booking_confirmations (
    idempotency_key, booking_id, booker_id, guest_proof_hash, order_fingerprint, stored_result
  ) values (
    v_key, v_booking.id, null, v_proof_hash, v_fingerprint, v_result
  );

  return v_result;
end;
$$;

revoke all on function public.book_departure_telegram(uuid, bigint, text, text, integer, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.book_departure_telegram(uuid, bigint, text, text, integer, integer, text, integer)
  to service_role;
