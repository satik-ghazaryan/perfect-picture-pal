-- Move unambiguous tour-level crew onto a dated departure.
-- Ambiguous rows are recorded and left unchanged. No next-weekend date is invented.

create table if not exists public.departure_assignment_conflicts (
  id bigint generated always as identity primary key,
  tour_id text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (tour_id, reason)
);

alter table public.departure_assignment_conflicts enable row level security;

drop policy if exists "admin read assignment conflicts" on public.departure_assignment_conflicts;
create policy "admin read assignment conflicts"
  on public.departure_assignment_conflicts for select
  to authenticated
  using (public.is_admin());

grant select on public.departure_assignment_conflicts to authenticated, service_role;
grant select, insert, update, delete on public.departures to authenticated, service_role;
grant usage, select on sequence public.departure_assignment_conflicts_id_seq to authenticated, service_role;

insert into public.departure_assignment_conflicts (tour_id, reason)
select tours.id, 'Տուրի աշխատակիցը կա, բայց միանշանակ մեկնման ամսաթիվ չկա։'
from public.tours
where (tours.guide_id is not null or tours.driver_id is not null)
  and tours.departure_date is null
on conflict (tour_id, reason) do nothing;

insert into public.departure_assignment_conflicts (tour_id, reason)
select tours.id, 'Տուրի guide_id հաշիվը զբոսավար չէ։'
from public.tours
left join public.profiles guide_profile on guide_profile.id = tours.guide_id
where tours.guide_id is not null
  and tours.departure_date is not null
  and (guide_profile.id is null or guide_profile.role <> 'guide')
on conflict (tour_id, reason) do nothing;

insert into public.departure_assignment_conflicts (tour_id, reason)
select tours.id, 'Տուրի driver_id հաշիվը վարորդ չէ։'
from public.tours
left join public.profiles driver_profile on driver_profile.id = tours.driver_id
where tours.driver_id is not null
  and tours.departure_date is not null
  and (driver_profile.id is null or driver_profile.role <> 'driver')
on conflict (tour_id, reason) do nothing;

insert into public.departure_assignment_conflicts (tour_id, reason)
select tours.id, 'Մեկնման զբոսավարը տարբերվում է տուրի guide_id-ից։'
from public.tours
join public.departures on departures.tour_id = tours.id and departures.departure_date = tours.departure_date
where tours.guide_id is not null
  and departures.guide_id is not null
  and departures.guide_id <> tours.guide_id
on conflict (tour_id, reason) do nothing;

insert into public.departure_assignment_conflicts (tour_id, reason)
select tours.id, 'Մեկնման վարորդը տարբերվում է տուրի driver_id-ից։'
from public.tours
join public.departures on departures.tour_id = tours.id and departures.departure_date = tours.departure_date
where tours.driver_id is not null
  and departures.driver_id is not null
  and departures.driver_id <> tours.driver_id
on conflict (tour_id, reason) do nothing;

insert into public.departures (tour_id, departure_date, available_seats, guide_id, driver_id)
select
  tours.id,
  tours.departure_date,
  coalesce(tours.seats, 0),
  case when guide_profile.role = 'guide' then tours.guide_id else null end,
  case when driver_profile.role = 'driver' then tours.driver_id else null end
from public.tours
left join public.profiles guide_profile on guide_profile.id = tours.guide_id
left join public.profiles driver_profile on driver_profile.id = tours.driver_id
where tours.departure_date is not null
  and (tours.guide_id is not null or tours.driver_id is not null)
  and (tours.guide_id is null or guide_profile.role = 'guide')
  and (tours.driver_id is null or driver_profile.role = 'driver')
  and not exists (
    select 1 from public.departures existing
    where existing.tour_id = tours.id and existing.departure_date = tours.departure_date
  )
  and not exists (
    select 1 from public.departure_assignment_conflicts conflict
    where conflict.tour_id = tours.id
  );

update public.departures
set
  guide_id = coalesce(departures.guide_id, tours.guide_id),
  driver_id = coalesce(departures.driver_id, tours.driver_id)
from public.tours
left join public.profiles guide_profile on guide_profile.id = tours.guide_id
left join public.profiles driver_profile on driver_profile.id = tours.driver_id
where departures.tour_id = tours.id
  and departures.departure_date = tours.departure_date
  and (tours.guide_id is null or guide_profile.role = 'guide')
  and (tours.driver_id is null or driver_profile.role = 'driver')
  and (departures.guide_id is null or departures.guide_id = tours.guide_id)
  and (departures.driver_id is null or departures.driver_id = tours.driver_id)
  and not exists (
    select 1 from public.departure_assignment_conflicts conflict
    where conflict.tour_id = tours.id
  );
