-- New accounts keep their email and birth date on the profile, so the profile page and the
-- admin list show them. Existing profiles are filled in from their sign-in accounts.

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
  insert into public.profiles (id, full_name, phone, email, role, points, birth_date)
  values (
    new.id,
    coalesce(meta_name, split_part(coalesce(new.email, ''), '@', 1), 'Tourist'),
    meta_phone,
    nullif(lower(trim(coalesce(new.email, ''))), ''),
    'tourist',
    0,
    case when meta_birth ~ '^\d{4}-\d{2}-\d{2}$' then meta_birth::date else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

update public.profiles p
set email = lower(u.email)
from auth.users u
where u.id = p.id
  and coalesce(p.email, '') = ''
  and coalesce(u.email, '') <> '';

update public.profiles p
set birth_date = (u.raw_user_meta_data->>'birth_date')::date
from auth.users u
where u.id = p.id
  and p.birth_date is null
  and coalesce(u.raw_user_meta_data->>'birth_date', '') ~ '^\d{4}-\d{2}-\d{2}$';
