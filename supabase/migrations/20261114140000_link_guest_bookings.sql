-- Linking bookings made without an account to a tourist's account.
--
-- A phone number alone is not proof: anyone can type someone else's number into a profile.
-- So a guest booking joins an account only with real proof that the person made it:
--
--   * claim_guest_booking: the ticket code plus the phone it was booked with (the same
--     proof the public ticket lookup uses). Covers old bookings and Telegram bookings.
--   * claim_guest_bookings_by_proof: the secret the browser kept when it made the booking,
--     and the booking phone matches the account's phone. Runs on its own after sign-in.
--
-- Only bookings that have no account yet are linked. Nothing else about them changes.

-- The booking guard lets non-admins change only attendance. Linking is the one more
-- exception: only inside the two functions below, only user_id, only from empty to set.
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
  if (to_jsonb(new) - 'attendance') is distinct from (to_jsonb(old) - 'attendance') then
    raise exception 'staff may only update attendance';
  end if;
  return new;
end;
$$;

create or replace function public.claim_guest_booking(p_ticket_code text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_ticket_code, '')));
  v_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8);
  v_count integer;
begin
  if v_user is null or not exists (
    select 1 from public.profiles where id = v_user and role = 'tourist'
  ) then
    return jsonb_build_object('ok', false, 'code', 'signin', 'message', 'Մուտք գործեք ձեր հաշիվ։');
  end if;
  if v_code !~ '^AG-[A-Z0-9-]{4,40}$' or length(v_tail) < 8 then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Գրեք տոմսի կոդը և հեռախոսահամարը։');
  end if;

  perform set_config('ari.linking_guest_booking', 'on', true);
  update public.bookings
  set user_id = v_user
  where upper(ticket_code) = v_code
    and user_id is null
    and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8) = v_tail;
  get diagnostics v_count = row_count;
  perform set_config('ari.linking_guest_booking', 'off', true);

  if v_count > 0 then
    return jsonb_build_object('ok', true, 'linked', v_count);
  end if;
  if exists (
    select 1 from public.bookings
    where upper(ticket_code) = v_code
      and user_id = v_user
      and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8) = v_tail
  ) then
    return jsonb_build_object('ok', true, 'linked', 0, 'already', true);
  end if;
  -- One answer for a wrong code, a wrong phone, or a booking in another account.
  return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Այս կոդով և հեռախոսով կցելու ամրագրում չգտնվեց։');
end;
$$;

revoke all on function public.claim_guest_booking(text, text) from public, anon;
grant execute on function public.claim_guest_booking(text, text) to authenticated;

create or replace function public.claim_guest_bookings_by_proof(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tail text;
  v_item jsonb;
  v_key text;
  v_proof text;
  v_booking public.bookings%rowtype;
  v_linked jsonb := '[]'::jsonb;
  v_done jsonb := '[]'::jsonb;
begin
  if v_user is null or jsonb_typeof(p_items) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'linked', v_linked, 'done', v_done);
  end if;
  select right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8)
  into v_tail
  from public.profiles
  where id = v_user and role = 'tourist';
  if v_tail is null then
    return jsonb_build_object('ok', false, 'linked', v_linked, 'done', v_done);
  end if;

  for v_item in select value from jsonb_array_elements(p_items) limit 50 loop
    v_key := v_item ->> 'key';
    v_proof := v_item ->> 'proof';
    if v_key is null or v_proof is null
      or v_key !~ '^[A-Za-z0-9_-]{16,80}$'
      or v_proof !~ '^[A-Za-z0-9_-]{16,80}$' then
      continue;
    end if;

    select b.* into v_booking
    from public.booking_confirmations c
    join public.bookings b on b.id = c.booking_id
    where c.idempotency_key = v_key
      and c.booker_id is null
      and c.guest_proof_hash = md5(v_proof)
    for update of b;

    if not found or v_booking.user_id is not null then
      -- Unknown, not a guest booking, or already in an account: nothing more to do.
      v_done := v_done || to_jsonb(v_key);
      continue;
    end if;
    if length(v_tail) < 8
      or right(regexp_replace(coalesce(v_booking.phone, ''), '\D', '', 'g'), 8) <> v_tail then
      -- Booked with another phone: keep it for the code-and-phone way.
      continue;
    end if;

    perform set_config('ari.linking_guest_booking', 'on', true);
    update public.bookings set user_id = v_user where id = v_booking.id and user_id is null;
    perform set_config('ari.linking_guest_booking', 'off', true);
    v_linked := v_linked || to_jsonb(v_booking.ticket_code);
    v_done := v_done || to_jsonb(v_key);
  end loop;

  return jsonb_build_object('ok', true, 'linked', v_linked, 'done', v_done);
end;
$$;

revoke all on function public.claim_guest_bookings_by_proof(jsonb) from public, anon;
grant execute on function public.claim_guest_bookings_by_proof(jsonb) to authenticated;
