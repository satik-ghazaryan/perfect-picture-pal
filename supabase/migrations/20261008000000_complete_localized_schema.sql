-- Canonical localized schema for Արի Գնանք.
-- Safe to run after earlier portal migrations: new columns are added in place.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text,
  role text not null default 'tourist' check (role in ('tourist', 'guide', 'driver', 'admin')),
  points integer not null default 0 check (points >= 0),
  birth_date date,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists points integer not null default 0;
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
update public.profiles set role = 'tourist' where role = 'customer';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('tourist', 'guide', 'driver', 'admin'));
alter table public.profiles alter column role set default 'tourist';

create table if not exists public.tours (
  id text primary key,
  title_hy text not null default '',
  title_en text not null default '',
  title_ru text not null default '',
  description_hy text not null default '',
  description_en text not null default '',
  description_ru text not null default '',
  location_hy text not null default '',
  location_en text not null default '',
  location_ru text not null default '',
  price integer not null default 0 check (price >= 0),
  image_url text,
  category text,
  created_at timestamptz not null default now()
);

alter table public.tours add column if not exists title_hy text not null default '';
alter table public.tours add column if not exists title_en text not null default '';
alter table public.tours add column if not exists title_ru text not null default '';
alter table public.tours add column if not exists description_hy text not null default '';
alter table public.tours add column if not exists description_en text not null default '';
alter table public.tours add column if not exists description_ru text not null default '';
alter table public.tours add column if not exists location_hy text not null default '';
alter table public.tours add column if not exists location_en text not null default '';
alter table public.tours add column if not exists location_ru text not null default '';
alter table public.tours add column if not exists price integer not null default 0;
alter table public.tours add column if not exists image_url text;
alter table public.tours add column if not exists category text;
alter table public.tours add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tours' and column_name = 'title' and data_type = 'jsonb'
  ) then
    update public.tours set
      title_hy = coalesce(nullif(title_hy, ''), title->>'hy', ''),
      title_en = coalesce(nullif(title_en, ''), title->>'en', ''),
      title_ru = coalesce(nullif(title_ru, ''), title->>'ru', ''),
      description_hy = coalesce(nullif(description_hy, ''), summary->>'hy', ''),
      description_en = coalesce(nullif(description_en, ''), summary->>'en', ''),
      description_ru = coalesce(nullif(description_ru, ''), summary->>'ru', ''),
      location_hy = coalesce(nullif(location_hy, ''), location->>'hy', ''),
      location_en = coalesce(nullif(location_en, ''), location->>'en', ''),
      location_ru = coalesce(nullif(location_ru, ''), location->>'ru', '');
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tours' and column_name = 'title' and data_type = 'text'
  ) then
    update public.tours set
      title_hy = coalesce(nullif(title_hy, ''), title, ''),
      description_hy = coalesce(nullif(description_hy, ''), summary, ''),
      location_hy = coalesce(nullif(location_hy, ''), region, category, ''),
      category = coalesce(category, region, location_hy);
  end if;
exception when others then
  null;
end $$;

create table if not exists public.virtual_tours (
  id text primary key,
  title_hy text not null default '',
  title_en text not null default '',
  title_ru text not null default '',
  description_hy text not null default '',
  description_en text not null default '',
  description_ru text not null default '',
  embed_url text,
  thumbnail_url text,
  created_at timestamptz not null default now()
);

alter table public.virtual_tours add column if not exists title_hy text not null default '';
alter table public.virtual_tours add column if not exists title_en text not null default '';
alter table public.virtual_tours add column if not exists title_ru text not null default '';
alter table public.virtual_tours add column if not exists description_hy text not null default '';
alter table public.virtual_tours add column if not exists description_en text not null default '';
alter table public.virtual_tours add column if not exists description_ru text not null default '';
alter table public.virtual_tours add column if not exists embed_url text;
alter table public.virtual_tours add column if not exists thumbnail_url text;
alter table public.virtual_tours add column if not exists created_at timestamptz not null default now();

create table if not exists public.departures (
  id uuid primary key default gen_random_uuid(),
  tour_id text not null references public.tours (id) on delete cascade,
  departure_date date not null,
  available_seats integer not null default 0 check (available_seats >= 0),
  guide_id uuid references public.profiles (id) on delete set null,
  driver_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tour_id, departure_date)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  departure_id uuid references public.departures (id) on delete cascade,
  seats_count integer not null default 1 check (seats_count > 0),
  total_price integer not null default 0 check (total_price >= 0),
  used_points integer not null default 0 check (used_points >= 0),
  status text not null default 'booked' check (status in ('booked', 'checked_in', 'cancelled')),
  attendance text not null default 'pending' check (attendance in ('present', 'absent', 'pending')),
  created_at timestamptz not null default now()
);

alter table public.bookings add column if not exists user_id uuid;
alter table public.bookings add column if not exists departure_id uuid;
alter table public.bookings add column if not exists seats_count integer not null default 1;
alter table public.bookings add column if not exists total_price integer not null default 0;
alter table public.bookings add column if not exists used_points integer not null default 0;
alter table public.bookings add column if not exists status text not null default 'booked';
alter table public.bookings add column if not exists attendance text not null default 'pending';
alter table public.bookings add column if not exists created_at timestamptz not null default now();
alter table public.bookings drop constraint if exists bookings_user_id_fkey;
alter table public.bookings add constraint bookings_user_id_fkey foreign key (user_id) references public.profiles (id) on delete set null;
alter table public.bookings drop constraint if exists bookings_departure_id_fkey;
alter table public.bookings add constraint bookings_departure_id_fkey foreign key (departure_id) references public.departures (id) on delete cascade;

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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_name text := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');
  meta_phone text := nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), '');
  meta_birth text := nullif(trim(coalesce(new.raw_user_meta_data->>'birth_date', '')), '');
begin
  insert into public.profiles (id, full_name, phone, role, points, birth_date)
  values (
    new.id,
    coalesce(meta_name, split_part(coalesce(new.email, ''), '@', 1), 'Tourist'),
    meta_phone,
    'tourist',
    0,
    case when meta_birth ~ '^\d{4}-\d{2}-\d{2}$' then meta_birth::date else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.tours enable row level security;
alter table public.virtual_tours enable row level security;
alter table public.departures enable row level security;
alter table public.bookings enable row level security;

drop policy if exists "public read tours" on public.tours;
create policy "public read tours"
  on public.tours for select
  to anon, authenticated
  using (true);

drop policy if exists "admin manage tours" on public.tours;
create policy "admin manage tours"
  on public.tours for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "public read virtual tours" on public.virtual_tours;
create policy "public read virtual tours"
  on public.virtual_tours for select
  to anon, authenticated
  using (true);

drop policy if exists "admin manage virtual tours" on public.virtual_tours;
create policy "admin manage virtual tours"
  on public.virtual_tours for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "public read departures" on public.departures;
create policy "public read departures"
  on public.departures for select
  to anon, authenticated
  using (true);

drop policy if exists "staff update assigned departures" on public.departures;
create policy "staff update assigned departures"
  on public.departures for update
  to authenticated
  using (guide_id = auth.uid() or driver_id = auth.uid() or public.is_admin())
  with check (guide_id = auth.uid() or driver_id = auth.uid() or public.is_admin());

drop policy if exists "admin manage departures" on public.departures;
create policy "admin manage departures"
  on public.departures for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "public read staff profiles" on public.profiles;
create policy "public read staff profiles"
  on public.profiles for select
  to anon, authenticated
  using (role in ('guide', 'driver'));

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select p.role from public.profiles p where p.id = auth.uid()));

drop policy if exists "admin manage profiles" on public.profiles;
create policy "admin manage profiles"
  on public.profiles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "users read own bookings" on public.bookings;
create policy "users read own bookings"
  on public.bookings for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "staff read assigned bookings" on public.bookings;
create policy "staff read assigned bookings"
  on public.bookings for select
  to authenticated
  using (
    exists (
      select 1 from public.departures
      where departures.id = bookings.departure_id
        and (departures.guide_id = auth.uid() or departures.driver_id = auth.uid())
    )
  );

drop policy if exists "users insert own bookings" on public.bookings;
create policy "users insert own bookings"
  on public.bookings for insert
  to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "guides update attendance" on public.bookings;
create policy "guides update attendance"
  on public.bookings for update
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.departures
      where departures.id = bookings.departure_id and departures.guide_id = auth.uid()
    )
  )
  with check (status in ('booked', 'checked_in', 'cancelled'));
