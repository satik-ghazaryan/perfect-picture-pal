-- Run in the Supabase SQL editor as a privileged role.

-- All policies on profiles and bookings.
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'bookings')
order by tablename, policyname;

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'public_staff',
    'bookings',
    'loyalty_accounts',
    'loyalty_ledger',
    'departures',
    'tours',
    'tour_photos'
  )
order by tablename, policyname;

select
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'profiles',
    'public_staff',
    'bookings',
    'loyalty_accounts',
    'loyalty_ledger',
    'departures',
    'tours',
    'tour_photos'
  )
  and grantee in ('anon', 'public', 'authenticated')
order by table_name, grantee, privilege_type;

select
  table_name,
  column_name,
  grantee,
  privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in (
    'profiles',
    'public_staff',
    'bookings',
    'loyalty_accounts',
    'loyalty_ledger'
  )
  and grantee in ('anon', 'public')
  and privilege_type = 'SELECT'
order by table_name, column_name, grantee;

-- Anon REST checks (use env placeholders; never paste real keys).
--
-- curl -sS "$SUPABASE_URL/rest/v1/profiles?select=*" \
--   -H "apikey: $SUPABASE_ANON_KEY" \
--   -H "Authorization: Bearer $SUPABASE_ANON_KEY"
-- after fix: 200, []
--
-- curl -sS "$SUPABASE_URL/rest/v1/public_staff?select=*" \
--   -H "apikey: $SUPABASE_ANON_KEY" \
--   -H "Authorization: Bearer $SUPABASE_ANON_KEY"
-- after fix: 200, id/full_name/avatar_url/role only
--
-- curl -sS "$SUPABASE_URL/rest/v1/bookings?select=*" \
--   -H "apikey: $SUPABASE_ANON_KEY" \
--   -H "Authorization: Bearer $SUPABASE_ANON_KEY"
-- expected: 200, []
--
-- STAGING ONLY — creates a real row
-- curl -sS -X POST "$SUPABASE_URL/rest/v1/bookings" \
--   -H "apikey: $SUPABASE_ANON_KEY" \
--   -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
--   -H "Content-Type: application/json" \
--   -H "Prefer: return=representation" \
--   -d '{"user_id":null,"seats_count":1,"total_price":0,"status":"booked"}'
-- Cleanup (SQL editor / privileged role; anon cannot DELETE):
--   delete from public.bookings where id = '<returned-id>';
