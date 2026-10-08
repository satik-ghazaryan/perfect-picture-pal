-- Link a physical departure to a 360° tour stored in virtual_tours.

create table if not exists public.virtual_tours (
  id text primary key,
  title text not null,
  image_url text,
  panorama_url text,
  virtual_tour_url text,
  summary text,
  hotspots jsonb not null default '[]'::jsonb
);

insert into public.virtual_tours (id, title, image_url, panorama_url, virtual_tour_url, summary)
select id, title, image_url, panorama_url, virtual_tour_url, summary
from public.tours
where is_virtual_only = true
on conflict (id) do update
set title = excluded.title,
    image_url = excluded.image_url,
    panorama_url = excluded.panorama_url,
    virtual_tour_url = excluded.virtual_tour_url,
    summary = excluded.summary;

alter table public.tours add column if not exists virtual_tour_id text;

alter table public.tours drop constraint if exists tours_virtual_tour_id_fkey;
alter table public.tours
  add constraint tours_virtual_tour_id_fkey
  foreign key (virtual_tour_id) references public.virtual_tours (id) on delete set null;

alter table public.tours drop constraint if exists tours_virtual_tour_id_not_self;
alter table public.tours
  add constraint tours_virtual_tour_id_not_self
  check (virtual_tour_id is null or virtual_tour_id <> id);

create index if not exists tours_virtual_tour_id_idx on public.tours (virtual_tour_id);

alter table public.virtual_tours enable row level security;

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
