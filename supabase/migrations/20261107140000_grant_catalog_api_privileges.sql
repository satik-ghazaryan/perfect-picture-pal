-- PostgREST needs table GRANTs in addition to RLS policies.
-- Current local Postgres 17 / CLI default does not auto-expose new public tables.

grant usage on schema public to anon, authenticated, service_role;

grant select on table
  public.tours,
  public.virtual_tours,
  public.site_settings,
  public.departures,
  public.public_staff
  to anon, authenticated, service_role;

grant insert, update, delete on table
  public.tours,
  public.virtual_tours,
  public.site_settings,
  public.departures
  to authenticated, service_role;

grant select on table public.profiles to authenticated, service_role;
grant update on table public.profiles to authenticated, service_role;

grant select on table
  public.bookings,
  public.loyalty_accounts,
  public.loyalty_ledger
  to anon, authenticated, service_role;

grant insert, update on table public.bookings to anon, authenticated, service_role;
grant insert on table public.loyalty_accounts, public.loyalty_ledger to authenticated, service_role;
grant update on table public.loyalty_accounts to authenticated, service_role;

grant select, insert on table public.tour_ideas to authenticated, service_role;
grant select, insert, delete on table public.tour_photos to authenticated, service_role;

grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
