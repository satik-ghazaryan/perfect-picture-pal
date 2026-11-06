-- Legacy virtual_tours.title is NOT NULL without a default on older databases.
-- Keep the column and give inserts a safe default; the app still writes title from title_hy.

alter table public.virtual_tours add column if not exists title text;
alter table public.virtual_tours add column if not exists image_url text;
alter table public.virtual_tours add column if not exists panorama_url text;
alter table public.virtual_tours add column if not exists virtual_tour_url text;
alter table public.virtual_tours add column if not exists summary text;
alter table public.virtual_tours add column if not exists hotspots jsonb not null default '[]'::jsonb;

update public.virtual_tours
set title = coalesce(nullif(title, ''), nullif(title_hy, ''), id)
where coalesce(title, '') = '';

alter table public.virtual_tours alter column title set default '';
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'virtual_tours'
      and column_name = 'title'
      and is_nullable = 'NO'
  ) then
    null;
  else
    update public.virtual_tours set title = coalesce(title, '') where title is null;
    alter table public.virtual_tours alter column title set not null;
  end if;
end $$;
