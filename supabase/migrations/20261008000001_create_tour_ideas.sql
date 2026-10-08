create table if not exists public.tour_ideas (
  id uuid default gen_random_uuid() primary key,
  inputs jsonb not null,
  generated_ideas jsonb not null,
  status text default 'draft',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.tour_ideas drop constraint if exists tour_ideas_status_check;
alter table public.tour_ideas add constraint tour_ideas_status_check
  check (status in ('draft', 'approved', 'rejected'));
alter table public.tour_ideas alter column status set default 'draft';

alter table public.tour_ideas enable row level security;

drop policy if exists "admin manage tour ideas" on public.tour_ideas;
create policy "admin manage tour ideas"
  on public.tour_ideas for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
