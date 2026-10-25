-- Paste into the Supabase SQL Editor. Same as
-- supabase/migrations/20261025000000_protect_profile_columns.sql
--
-- Loyalty (apply_loyalty / revert_loyalty / get_loyalty) writes public.loyalty_accounts.points,
-- not public.profiles.points. handle_new_user only INSERTs profiles (role tourist, points 0);
-- this trigger is BEFORE UPDATE, so signup is unaffected. No other function UPDATEs
-- profiles.points. Admin role changes still work via public.is_admin().

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

-- Verification: list triggers on public.profiles
select
  t.tgname,
  pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where t.tgrelid = 'public.profiles'::regclass
  and not t.tgisinternal
order by t.tgname;

-- Manual test (do this as a tourist, not in this editor as postgres):
-- 1. Sign in on the site as a tourist (or use that user's access token).
-- 2. PATCH /rest/v1/profiles?id=eq.<their-uuid> with Authorization: Bearer <user-jwt>
--    and body {"role":"admin"}     -- expect error
--    then {"points":999999}        -- expect error
--    then {"full_name":"Test Name"} -- expect 200 / success
-- 3. Changing full_name, phone, avatar_url, bio, or birth_date should succeed.
-- 4. An admin JWT may still change role.

-- Rollback
-- drop trigger if exists protect_profile_privileged_columns on public.profiles;
-- drop function if exists public.protect_profile_privileged_columns();
