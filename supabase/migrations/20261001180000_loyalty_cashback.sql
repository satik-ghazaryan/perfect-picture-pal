-- Replace the loyalty apply function so the ledger note uses the cashback
-- rate from the active admin settings, and add a matching revert.

drop function if exists public.apply_loyalty(text, text, integer, integer, text, text);

create or replace function public.apply_loyalty(
  p_phone text,
  p_name text,
  p_redeem integer,
  p_earn integer,
  p_tour_id text,
  p_tour_title text,
  p_cashback_percent integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_points integer;
  history jsonb;
begin
  if length(trim(p_phone)) < 8
    or p_redeem < 0
    or p_earn < 0
    or p_cashback_percent < 0
    or p_cashback_percent > 100 then
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
    values (
      trim(p_phone),
      p_tour_id,
      p_tour_title,
      'earn',
      p_earn,
      p_cashback_percent::text || '% հետվճար՝ ' || p_tour_title,
      clock_timestamp()
    );
  end if;

  update public.loyalty_accounts
  set points = points - p_redeem + p_earn
  where phone = trim(p_phone);

  select public.get_loyalty(trim(p_phone)) into history;
  return history || jsonb_build_object('redeemed', p_redeem, 'earned', p_earn);
end;
$$;

create or replace function public.revert_loyalty(
  p_phone text,
  p_redeem integer,
  p_earn integer,
  p_tour_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_points integer;
begin
  if length(trim(p_phone)) < 8 or p_redeem < 0 or p_earn < 0 then
    raise exception 'Միավորների վերականգնումը թերի է';
  end if;

  select points into current_points
  from public.loyalty_accounts
  where phone = trim(p_phone)
  for update;

  if not found then
    raise exception 'Միավորների հաշիվը չի գտնվել';
  end if;

  if p_redeem > 0 then
    delete from public.loyalty_ledger
    where id = (
      select id
      from public.loyalty_ledger
      where phone = trim(p_phone)
        and tour_id = p_tour_id
        and kind = 'redeem'
        and points = p_redeem
      order by created_at desc
      limit 1
    );
    if not found then
      raise exception 'Միավորների գրառումը չվերականգնվեց';
    end if;
  end if;

  if p_earn > 0 then
    delete from public.loyalty_ledger
    where id = (
      select id
      from public.loyalty_ledger
      where phone = trim(p_phone)
        and tour_id = p_tour_id
        and kind = 'earn'
        and points = p_earn
      order by created_at desc
      limit 1
    );
    if not found then
      raise exception 'Միավորների գրառումը չվերականգնվեց';
    end if;
  end if;

  update public.loyalty_accounts
  set points = points + p_redeem - p_earn
  where phone = trim(p_phone);

  return public.get_loyalty(trim(p_phone));
end;
$$;

grant execute on function public.apply_loyalty(text, text, integer, integer, text, text, integer) to anon, authenticated;
grant execute on function public.revert_loyalty(text, integer, integer, text) to anon, authenticated;
