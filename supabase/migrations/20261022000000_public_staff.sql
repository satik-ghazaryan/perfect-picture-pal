-- Anon and authenticated non-admins may read only safe staff fields.
-- Contact data stays on profiles. Drop the old public SELECT on the base table.

drop policy if exists "public read staff profiles" on public.profiles;

-- public_staff is intentionally security definer (security_invoker = false)
-- so it can return rows while profiles RLS stays closed to anon. It exposes
-- only id, full_name, avatar_url, role — never phone, email, or other contact data.
drop view if exists public.public_staff;
create view public.public_staff
  with (security_invoker = false, security_barrier = true)
as
select
  id,
  full_name,
  avatar_url,
  role
from public.profiles
where role in ('guide', 'driver');

revoke all on public.public_staff from public, anon, authenticated;
grant select on public.public_staff to anon, authenticated;
