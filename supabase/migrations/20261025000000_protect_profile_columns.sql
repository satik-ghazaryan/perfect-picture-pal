-- Block non-admin changes to id, role, and points on public.profiles.
-- RLS is unchanged. Safe columns (name, phone, avatar, bio, birth_date, …) stay updatable.

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is not distinct from old.id
     and new.role is not distinct from old.role
     and new.points is not distinct from old.points then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  -- SQL editor / maintenance: no JWT, privileged database role.
  if auth.uid() is null
     and current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  raise exception 'Protected profile columns cannot be changed';
end;
$$;

drop trigger if exists protect_profile_privileged_columns on public.profiles;
create trigger protect_profile_privileged_columns
  before update on public.profiles
  for each row
  execute function public.protect_profile_privileged_columns();
