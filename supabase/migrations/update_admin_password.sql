-- MANUAL ONE-OFF. Do not rely on `supabase db push` for this file.
-- Run it in the Supabase Dashboard → SQL Editor (needs access to auth.users).
-- Then confirm public.profiles.role stays 'admin'.

create extension if not exists pgcrypto;

-- If arev@ already exists, only the password is rotated.
-- If the user is missing, this does not insert into auth.users (use the Node script for that).
update auth.users
set
  encrypted_password = crypt('#arev#', gen_salt('bf')),
  updated_at = now()
where lower(email) = 'arev@arignank.am';

insert into public.profiles (id, full_name, email, role)
select u.id, coalesce(nullif(trim(p.full_name), ''), 'Ադմինիստրատոր'), u.email, 'admin'
from auth.users u
left join public.profiles p on p.id = u.id
where lower(u.email) = 'arev@arignank.am'
on conflict (id) do update
set
  email = excluded.email,
  role = 'admin';

update public.profiles
set role = 'admin'
where id = (
  select id from auth.users where lower(email) = 'arev@arignank.am'
);

select
  u.id,
  u.email,
  p.role,
  p.full_name
from auth.users u
left join public.profiles p on p.id = u.id
where lower(u.email) = 'arev@arignank.am';
