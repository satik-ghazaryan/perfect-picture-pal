alter table public.tours add column if not exists virtual_tour_url text;
alter table public.tours add column if not exists is_virtual_only boolean not null default false;
