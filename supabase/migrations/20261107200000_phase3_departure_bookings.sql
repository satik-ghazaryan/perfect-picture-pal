-- Book a specific departure in one transaction and close the old public write path.

create table if not exists public.booking_confirmations (
  idempotency_key text primary key,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.booking_confirmations enable row level security;
revoke all on public.booking_confirmations from public, anon, authenticated;

create table if not exists public.booking_departure_conflicts (
  id bigint generated always as identity primary key,
  booking_id uuid not null,
  tour_id text not null,
  ticket_code text,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (booking_id, reason)
);

alter table public.booking_departure_conflicts enable row level security;

drop policy if exists "admin read booking link conflicts" on public.booking_departure_conflicts;
create policy "admin read booking link conflicts"
  on public.booking_departure_conflicts for select
  to authenticated
  using (public.is_admin());

grant select on public.booking_departure_conflicts to authenticated, service_role;

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
  v_seats integer;
  v_phone text;
  v_balance integer := 0;
  v_redeem integer := 0;
  v_payable integer;
  v_earn integer := 0;
  v_user uuid;
  v_role text;
  v_existing uuid;
  v_booking public.bookings%rowtype;
  v_first integer;
  v_ticket text;
  v_numbers jsonb;
  v_points integer := 0;
  v_attempt integer := 0;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,80}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Հաստատման բանալին սխալ է։');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));

  select booking_id into v_existing
  from public.booking_confirmations
  where idempotency_key = p_idempotency_key;

  if v_existing is not null then
    select * into v_booking from public.bookings where id = v_existing;
    select coalesce(points, 0) into v_points
    from public.loyalty_accounts
    where phone = regexp_replace(v_booking.phone, '\D', '', 'g');
    return jsonb_build_object(
      'ok', true,
      'repeated', true,
      'booking_id', v_booking.id,
      'ticket_code', v_booking.ticket_code,
      'seat_number', v_booking.seat_number,
      'seats_count', v_booking.seats_count,
      'payable', v_booking.amount,
      'redeemed', v_booking.used_points,
      'earned', 0,
      'points', coalesce(v_points, 0),
      'departure_date', (select departure_date from public.departures where id = v_booking.departure_id)
    );
  end if;

  v_seats := coalesce(p_adults, 0) + coalesce(p_children, 0);
  if length(trim(coalesce(p_passenger_name, ''))) < 2
    or length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 8
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

  select price, title into v_price, v_title from public.tours where id = v_departure.tour_id;
  select cashback_percent into v_cashback from public.site_settings where id = 1;
  v_price := coalesce(v_price, 0);
  v_cashback := coalesce(v_cashback, 0);

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

  v_phone := regexp_replace(p_phone, '\D', '', 'g');
  select points into v_balance from public.loyalty_accounts where phone = v_phone for update;
  v_balance := coalesce(v_balance, 0);
  if p_use_points then
    v_redeem := least(v_balance, v_price * v_seats);
  end if;
  if coalesce(p_use_points, false) and v_redeem < 1 then
    return jsonb_build_object('ok', false, 'code', 'points', 'message', 'Միավորները բավարար չեն։');
  end if;
  v_payable := v_price * v_seats - v_redeem;
  v_earn := floor(v_payable * v_cashback / 100.0)::integer;

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
        v_ticket, 'booked', p_adults, p_children, v_price * v_seats, v_redeem, v_payable,
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

  insert into public.booking_confirmations (idempotency_key, booking_id)
  values (p_idempotency_key, v_booking.id);

  if v_redeem > 0 or v_earn > 0 then
    perform public.apply_loyalty(v_phone, trim(p_passenger_name), v_redeem, v_earn, v_departure.tour_id, coalesce(v_title, v_departure.tour_id), v_cashback);
  end if;

  select coalesce(points, 0) into v_points from public.loyalty_accounts where phone = v_phone;

  return jsonb_build_object(
    'ok', true,
    'repeated', false,
    'booking_id', v_booking.id,
    'ticket_code', v_booking.ticket_code,
    'seat_number', v_first,
    'seat_numbers', v_numbers,
    'seats_count', v_seats,
    'payable', v_payable,
    'redeemed', v_redeem,
    'earned', v_earn,
    'points', coalesce(v_points, 0),
    'departure_date', v_departure.departure_date,
    'available_seats', v_departure.available_seats - v_seats
  );
end;
$$;

revoke all on function public.book_departure(uuid, text, text, text, integer, integer, boolean, text, text, date, integer, integer, integer) from public;
grant execute on function public.book_departure(uuid, text, text, text, integer, integer, boolean, text, text, date, integer, integer, integer) to anon, authenticated, service_role;

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
begin
  raise exception 'create_booking is closed';
end;
$$;

create or replace function public.set_booking_payment(
  p_ticket_code text,
  p_provider text,
  p_status text,
  p_amount integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'set_booking_payment is closed';
end;
$$;

revoke all on function public.create_booking(text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.set_booking_payment(text, text, text, integer) from public, anon, authenticated;

revoke insert, update, delete on public.bookings from anon, authenticated;
grant update (attendance) on public.bookings to authenticated;

with matches as (
  select bookings.id as booking_id, departures.id as departure_id
  from public.bookings
  join public.tours on tours.id = bookings.tour_id
  join public.departures
    on departures.tour_id = bookings.tour_id
   and departures.departure_date = tours.departure_date
  where bookings.departure_id is null
    and tours.departure_date is not null
),
unique_matches as (
  select booking_id, (array_agg(departure_id))[1] as departure_id
  from matches
  group by booking_id
  having count(*) = 1
)
update public.bookings
set departure_id = unique_matches.departure_id
from unique_matches
where bookings.id = unique_matches.booking_id
  and bookings.departure_id is null;

insert into public.booking_departure_conflicts (booking_id, tour_id, ticket_code, reason)
select
  bookings.id,
  bookings.tour_id,
  bookings.ticket_code,
  case
    when tours.departure_date is null then 'Նույն տուրի ID-ն բավարար չէ. վստահելի մեկնման ամսաթիվ չկա։'
    when (
      select count(*)
      from public.departures
      where departures.tour_id = bookings.tour_id
        and departures.departure_date = tours.departure_date
    ) > 1 then 'Այդ ամսաթվով մեկից ավելի մեկնում կա։'
    else 'Տուրի ամսաթվով համապատասխան մեկնում չկա։'
  end
from public.bookings
left join public.tours on tours.id = bookings.tour_id
where bookings.departure_id is null
on conflict (booking_id, reason) do nothing;
