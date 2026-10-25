# Bookings hardening (proposal only — do not apply yet)

## Current writers

`create_booking(p_tour_id, p_passenger_name, p_phone, p_ticket_code, p_adults, p_children)` is `security definer`. It assigns `seat_number` as `max(seat_number)+1` for that `tour_id`, forces `status = 'booked'`, and inserts name/phone/ticket/adults/children. It does **not** read `tours.price` or `departures`. It does **not** set `total_price` (column default `0`) or `user_id`.

`set_booking_payment(p_ticket_code, p_provider, p_status, p_amount)` is `security definer`. It writes `payment_provider`, `payment_status`, and `amount = greatest(p_amount, 0)` for that ticket. `p_amount` comes from the client.

No other SQL function inserts bookings. App loyalty uses `loyalty_accounts`, not booking price.

## Answers

**(a)** Seat index is computed server-side. **Price is not.** Catalog price is not applied in `create_booking`. Payable amount is whatever the client passes to `set_booking_payment`.

**(b)** The RPC has no `user_id` argument, so the client cannot set it through `create_booking`. Direct REST INSERT can still set `user_id` (see policies).

**(c)** Grep of `src/`: there is **no** `.from("bookings").insert`. Public checkout uses `rpc("create_booking")` then `rpc("set_booking_payment")`. Guide/admin paths only `select` / `update` (attendance, check-in). The INSERT policies `"public can book a seat"` and `"users insert own bookings"` are **not** used by current TypeScript. They still allow anyone with the anon key to POST `/rest/v1/bookings`.

**(d)** Minimal later migration (not in this change):

1. Replace both INSERT policies with one: `to anon, authenticated` `with check (status = 'booked' and (user_id is null or user_id = auth.uid()))`.
2. Optionally `revoke insert on public.bookings from anon, authenticated` if all inserts must go through `create_booking`.
3. Stop accepting client `p_amount`: compute `amount` from `tours.price` (and party size) inside `set_booking_payment` or `create_booking`.
4. Keep guide UPDATE policies as a follow-up (they currently allow changing any column if USING matches).
