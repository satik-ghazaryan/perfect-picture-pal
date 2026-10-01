-- Loyalty points: 5% of the amount paid on Armavir departures, 1 point = 1 AMD.

create table if not exists public.loyalty_accounts (
  phone text primary key,
  full_name text not null,
  points integer not null default 0 check (points >= 0)
);

create table if not exists public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  phone text not null references public.loyalty_accounts (phone) on delete cascade,
  tour_id text,
  tour_title text,
  kind text not null check (kind in ('earn', 'redeem')),
  points integer not null check (points > 0),
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists loyalty_ledger_phone_idx on public.loyalty_ledger (phone, created_at desc);

alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_ledger enable row level security;

create or replace function public.get_loyalty(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account public.loyalty_accounts;
  history jsonb;
begin
  select * into account from public.loyalty_accounts where phone = p_phone;
  if not found then
    return jsonb_build_object('phone', p_phone, 'full_name', '', 'points', 0, 'history', '[]'::jsonb);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'tourId', tour_id,
        'tourTitle', tour_title,
        'kind', kind,
        'points', points,
        'note', note,
        'createdAt', created_at
      )
      order by created_at desc
    ),
    '[]'::jsonb
  )
  into history
  from public.loyalty_ledger
  where phone = p_phone;

  return jsonb_build_object(
    'phone', account.phone,
    'full_name', account.full_name,
    'points', account.points,
    'history', history
  );
end;
$$;

create or replace function public.apply_loyalty(
  p_phone text,
  p_name text,
  p_redeem integer,
  p_earn integer,
  p_tour_id text,
  p_tour_title text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_points integer;
  history jsonb;
begin
  if length(trim(p_phone)) < 8 or p_redeem < 0 or p_earn < 0 then
    raise exception 'Միավորների հարցումը թերի է';
  end if;

  insert into public.loyalty_accounts (phone, full_name, points)
  values (trim(p_phone), trim(p_name), 0)
  on conflict (phone) do update set full_name = excluded.full_name;

  select points into current_points
  from public.loyalty_accounts
  where phone = trim(p_phone)
  for update;

  if p_redeem > current_points then
    raise exception 'Միավորները բավարար չեն';
  end if;

  if p_redeem > 0 then
    insert into public.loyalty_ledger (phone, tour_id, tour_title, kind, points, note, created_at)
    values (trim(p_phone), p_tour_id, p_tour_title, 'redeem', p_redeem, 'Զեղչ՝ ' || p_tour_title, clock_timestamp());
  end if;

  if p_earn > 0 then
    insert into public.loyalty_ledger (phone, tour_id, tour_title, kind, points, note, created_at)
    values (trim(p_phone), p_tour_id, p_tour_title, 'earn', p_earn, '5% հետվճար՝ ' || p_tour_title, clock_timestamp());
  end if;

  update public.loyalty_accounts
  set points = points - p_redeem + p_earn
  where phone = trim(p_phone);

  select public.get_loyalty(trim(p_phone)) into history;
  return history || jsonb_build_object('redeemed', p_redeem, 'earned', p_earn);
end;
$$;

grant execute on function public.get_loyalty(text) to anon, authenticated;
grant execute on function public.apply_loyalty(text, text, integer, integer, text, text) to anon, authenticated;
