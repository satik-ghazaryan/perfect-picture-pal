-- Persist admin catalog fields without dropping legacy portal columns.
-- Catalog weekday lives in tours.day ('saturday' | 'sunday').
-- tours.departure_date stays for the guide portal and is no longer required
-- on catalog rows, so new tours do not invent a calendar date.

alter table public.tours add column if not exists type text;
alter table public.tours add column if not exists return_time text;
alter table public.tours add column if not exists highlights jsonb not null default '[]'::jsonb;
alter table public.tours add column if not exists included jsonb not null default '[]'::jsonb;
alter table public.tours add column if not exists excluded jsonb not null default '[]'::jsonb;
alter table public.tours add column if not exists hotspots jsonb not null default '[]'::jsonb;
alter table public.tours add column if not exists old_price integer;
alter table public.tours add column if not exists rating numeric;
alter table public.tours add column if not exists reviews integer not null default 0;
alter table public.tours add column if not exists has360 boolean not null default false;
alter table public.tours add column if not exists has_audio_guide boolean not null default false;
alter table public.tours add column if not exists is_virtual_only boolean not null default false;
alter table public.tours add column if not exists panorama_url text;
alter table public.tours add column if not exists itinerary jsonb not null default '[]'::jsonb;
alter table public.tours add column if not exists audio_chapters jsonb not null default '[]'::jsonb;
alter table public.tours add column if not exists day text;
alter table public.tours add column if not exists virtual_tour_url text;
alter table public.tours add column if not exists virtual_tour_id text;
alter table public.tours add column if not exists seats integer not null default 0;

alter table public.tours drop constraint if exists tours_type_check;
alter table public.tours
  add constraint tours_type_check
  check (type is null or type in ('Արշավային', 'Մշակութային', 'Էքստրեմալ'));

alter table public.tours drop constraint if exists tours_day_check;
alter table public.tours
  add constraint tours_day_check
  check (day is null or day in ('saturday', 'sunday'));

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tours'
      and column_name = 'departure_date'
      and is_nullable = 'NO'
  ) then
    alter table public.tours alter column departure_date drop not null;
  end if;
end $$;

update public.tours
set title = title_hy
where coalesce(title, '') = ''
  and coalesce(title_hy, '') <> '';

drop policy if exists "public read site settings" on public.site_settings;
create policy "public read site settings"
  on public.site_settings for select
  to anon, authenticated
  using (true);
