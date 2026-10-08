-- Profiles use tourist as the default role, and guides/drivers can carry a photo and bio.

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;

update public.profiles set role = 'tourist' where role = 'customer';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('tourist', 'guide', 'driver', 'admin'));

alter table public.profiles alter column role set default 'tourist';

drop policy if exists "public read staff profiles" on public.profiles;
create policy "public read staff profiles"
  on public.profiles for select
  to anon, authenticated
  using (role in ('guide', 'driver'));

drop policy if exists "admin update profiles" on public.profiles;
create policy "admin update profiles"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
