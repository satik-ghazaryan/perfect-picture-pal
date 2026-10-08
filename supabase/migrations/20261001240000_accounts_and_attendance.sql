-- Tourist birth dates and guide attendance on a departure.

alter table public.profiles add column if not exists birth_date date;

alter table public.bookings add column if not exists attendance text;

alter table public.bookings drop constraint if exists bookings_attendance_check;
alter table public.bookings
  add constraint bookings_attendance_check
  check (attendance is null or attendance in ('present', 'absent'));
