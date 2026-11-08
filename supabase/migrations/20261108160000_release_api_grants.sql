-- The release API roles can read the public catalog and the signed-in passenger list.
-- Row security still decides which rows each account may see. Direct booking writes stay closed.

grant select on public.tours, public.virtual_tours, public.site_settings, public.departures
  to anon, authenticated, service_role;

grant insert, update, delete on public.tours, public.virtual_tours
  to authenticated, service_role;

grant insert, update on public.site_settings
  to authenticated, service_role;

grant select, insert, delete on public.tour_photos
  to authenticated, service_role;

grant select, update on public.profiles
  to authenticated, service_role;

grant select on public.bookings
  to authenticated, service_role;
