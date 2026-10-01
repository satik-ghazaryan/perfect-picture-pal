-- Admin catalog: richer tours, payment fields, site settings, and admin access.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('guide', 'driver', 'customer', 'admin'));

alter table public.tours add column if not exists price integer not null default 0;
alter table public.tours add column if not exists seats integer not null default 0;
alter table public.tours add column if not exists image_url text;
alter table public.tours add column if not exists panorama_url text;
alter table public.tours add column if not exists summary text;
alter table public.tours add column if not exists region text;
alter table public.tours add column if not exists day text;
alter table public.tours add column if not exists itinerary jsonb not null default '[]'::jsonb;
alter table public.tours add column if not exists audio_chapters jsonb not null default '[]'::jsonb;

alter table public.bookings add column if not exists payment_provider text;
alter table public.bookings add column if not exists payment_status text;
alter table public.bookings add column if not exists amount integer not null default 0;

create table if not exists public.site_settings (
  id integer primary key default 1 check (id = 1),
  banner_title text not null,
  banner_text text not null,
  departure_place text not null,
  cashback_percent integer not null check (cashback_percent between 0 and 100)
);

insert into public.site_settings (id, banner_title, banner_text, departure_place, cashback_percent)
values (
  1,
  E'Բացահայտիր Հայաստանը\nմեկ օրում',
  'Հնագույն վանքեր, լեռնային լճեր ու անմոռանալի տեսարաններ՝ փոքր խմբերով ճանապարհորդություններ, որոնք սկսվում են Արմավիրից։',
  'Արմավիր քաղաք, Կենտրոնական հրապարակ',
  5
)
on conflict (id) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
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
  if p_provider not in ('idram', 'telcell', 'arca') then
    raise exception 'Unknown payment provider';
  end if;
  if p_status not in ('SUCCESS', 'FAILED', 'PENDING') then
    raise exception 'Unknown payment status';
  end if;
  update public.bookings
  set payment_provider = p_provider,
      payment_status = p_status,
      amount = greatest(p_amount, 0)
  where ticket_code = upper(trim(p_ticket_code));
end;
$$;

grant execute on function public.set_booking_payment(text, text, text, integer) to anon, authenticated;

alter table public.site_settings enable row level security;

drop policy if exists "admin read profiles" on public.profiles;
create policy "admin read profiles"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admin manage tours" on public.tours;
create policy "admin manage tours"
  on public.tours for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin read bookings" on public.bookings;
create policy "admin read bookings"
  on public.bookings for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admin manage settings" on public.site_settings;
create policy "admin manage settings"
  on public.site_settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
