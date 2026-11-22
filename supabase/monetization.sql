create table if not exists public.rimbly_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null check (plan_id in ('weekly', 'monthly', 'semester')),
  status text not null default 'active' check (status in ('active', 'expired')),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  provider_reference text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.rimbly_billing_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null check (plan_id in ('weekly', 'monthly', 'semester')),
  transaction_ref text not null unique,
  amount_kobo integer not null check (amount_kobo > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists rimbly_billing_payments_user_created_idx
  on public.rimbly_billing_payments (user_id, created_at desc);
create index if not exists quiz_set_attempts_user_created_at_idx
  on public.quiz_set_attempts (user_id, created_at desc);
create index if not exists quiz_attempts_user_created_at_idx
  on public.quiz_attempts (user_id, created_at desc);
create index if not exists battle_challenges_challenger_created_at_idx
  on public.battle_challenges (challenger_id, created_at desc);

alter table public.rimbly_subscriptions enable row level security;
alter table public.rimbly_billing_payments enable row level security;

revoke all on public.rimbly_subscriptions from public, anon;
revoke insert, update, delete on public.rimbly_subscriptions from authenticated;
grant select on public.rimbly_subscriptions to authenticated;
grant all on public.rimbly_subscriptions to service_role;

revoke all on public.rimbly_billing_payments from public, anon, authenticated;
grant all on public.rimbly_billing_payments to service_role;

drop policy if exists "Users can view their Rimbly Pro subscription"
  on public.rimbly_subscriptions;
create policy "Users can view their Rimbly Pro subscription"
  on public.rimbly_subscriptions
  for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.is_rimbly_pro_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.rimbly_subscriptions subscription
    where subscription.user_id = p_user_id
      and subscription.status = 'active'
      and subscription.expires_at > now()
  );
$$;

revoke all on function public.is_rimbly_pro_active(uuid) from public, anon, authenticated;

create or replace function public.get_my_rimbly_billing_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  utc_day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  subscription public.rimbly_subscriptions%rowtype;
  latest_payment public.rimbly_billing_payments%rowtype;
  quiz_count integer;
  battle_count integer;
  completed_battles_today integer;
  active_pro boolean;
begin
  if current_user_id is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  select * into subscription
  from public.rimbly_subscriptions
  where user_id = current_user_id;

  active_pro := coalesce(
    subscription.status = 'active' and subscription.expires_at > now(),
    false
  );

  select count(*)::integer into quiz_count
  from (
    select attempt.id
    from public.quiz_set_attempts attempt
    where attempt.user_id = current_user_id and attempt.created_at >= utc_day_start
    union all
    select attempt.id
    from public.quiz_attempts attempt
    where attempt.user_id = current_user_id and attempt.created_at >= utc_day_start
  ) attempts;

  select count(*)::integer into battle_count
  from public.battle_challenges challenge
  where challenge.challenger_id = current_user_id
    and challenge.created_at >= utc_day_start;

  select count(*)::integer into completed_battles_today
  from public.battle_submissions submission
  where submission.user_id = current_user_id
    and submission.submitted_at >= utc_day_start;

  select * into latest_payment
  from public.rimbly_billing_payments payment
  where payment.user_id = current_user_id
  order by payment.created_at desc
  limit 1;

  return jsonb_build_object(
    'is_pro', active_pro,
    'plan_id', case when active_pro then subscription.plan_id else 'free' end,
    'expires_at', case when active_pro then subscription.expires_at else null end,
    'quizzes_used_today', coalesce(quiz_count, 0),
    'free_quiz_limit', case
      when coalesce(quiz_count, 0) > 0 or coalesce(completed_battles_today, 0) > 0 then 6
      else 5
    end,
    'battle_invites_used_today', coalesce(battle_count, 0),
    'free_battle_limit', 3,
    'completed_battles_today', coalesce(completed_battles_today, 0),
    'did_practice_today', coalesce(quiz_count, 0) > 0
      or coalesce(completed_battles_today, 0) > 0,
    'latest_payment_ref', latest_payment.transaction_ref,
    'latest_payment_status', latest_payment.status
  );
end;
$$;

revoke all on function public.get_my_rimbly_billing_status() from public, anon;
grant execute on function public.get_my_rimbly_billing_status() to authenticated;

create or replace function public.create_rimbly_pro_checkout(
  p_user_id uuid,
  p_plan_id text,
  p_transaction_ref text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  expected_amount integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the checkout service can create payment records'
      using errcode = '42501';
  end if;
  expected_amount := case p_plan_id
    when 'weekly' then 50000
    when 'monthly' then 250000
    when 'semester' then 800000
    else null
  end;
  if p_user_id is null
    or p_transaction_ref is null
    or expected_amount is null
    or p_transaction_ref !~ '^rimbly_[a-f0-9]{32}$' then
    raise exception 'Invalid Rimbly Pro checkout request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));
  if exists (
    select 1
    from public.rimbly_billing_payments payment
    where payment.user_id = p_user_id
      and payment.status = 'pending'
      and payment.created_at > now() - interval '30 minutes'
  ) then
    raise exception 'RIMBLY_CHECKOUT_PENDING';
  end if;

  insert into public.rimbly_billing_payments (
    user_id, plan_id, transaction_ref, amount_kobo, status
  )
  values (p_user_id, p_plan_id, p_transaction_ref, expected_amount, 'pending');
  return expected_amount;
end;
$$;

revoke all on function public.create_rimbly_pro_checkout(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_rimbly_pro_checkout(uuid, text, text)
  to service_role;

create or replace function public.activate_rimbly_pro_payment(
  p_transaction_ref text,
  p_amount_kobo integer,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  payment public.rimbly_billing_payments%rowtype;
  period interval;
  expected_amount integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the verified payment service can activate subscriptions'
      using errcode = '42501';
  end if;
  if p_transaction_ref is null or p_amount_kobo is null or p_currency is distinct from 'NGN' then
    raise exception 'Rimbly Pro payments must be settled in NGN';
  end if;

  select * into payment
  from public.rimbly_billing_payments
  where transaction_ref = p_transaction_ref
  for update;
  if not found then
    raise exception 'Payment reference was not found';
  end if;
  if payment.status = 'paid' then
    return jsonb_build_object('activated', true, 'already_processed', true);
  end if;
  if payment.status <> 'pending' then
    raise exception 'This payment is no longer pending';
  end if;
  expected_amount := case payment.plan_id
    when 'weekly' then 50000
    when 'monthly' then 250000
    when 'semester' then 800000
  end;
  if payment.amount_kobo <> expected_amount then
    raise exception 'Stored checkout amount does not match the selected plan';
  end if;
  if payment.amount_kobo <> p_amount_kobo then
    raise exception 'Verified payment amount does not match the checkout';
  end if;

  period := case payment.plan_id
    when 'weekly' then interval '7 days'
    when 'monthly' then interval '1 month'
    when 'semester' then interval '4 months'
  end;

  update public.rimbly_billing_payments
  set status = 'paid', paid_at = now()
  where id = payment.id;

  insert into public.rimbly_subscriptions (
    user_id, plan_id, status, starts_at, expires_at, provider_reference, updated_at
  )
  values (
    payment.user_id, payment.plan_id, 'active', now(), now() + period,
    payment.transaction_ref, now()
  )
  on conflict (user_id) do update
  set plan_id = excluded.plan_id,
      status = 'active',
      starts_at = case
        when public.rimbly_subscriptions.status = 'active'
          and public.rimbly_subscriptions.expires_at > now()
        then public.rimbly_subscriptions.expires_at
        else now()
      end,
      expires_at = case
        when public.rimbly_subscriptions.status = 'active'
          and public.rimbly_subscriptions.expires_at > now()
        then public.rimbly_subscriptions.expires_at
        else now()
      end + period,
      provider_reference = excluded.provider_reference,
      updated_at = now();

  return jsonb_build_object('activated', true, 'already_processed', false);
end;
$$;

revoke all on function public.activate_rimbly_pro_payment(text, integer, text)
  from public, anon, authenticated;
grant execute on function public.activate_rimbly_pro_payment(text, integer, text)
  to service_role;

create or replace function public.enforce_rimbly_free_quiz_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  utc_day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  quiz_count integer;
  quiz_limit integer := 5;
begin
  if auth.role() is distinct from 'service_role'
    and auth.uid() is distinct from new.user_id then
    raise exception 'Quiz attempts must belong to the signed-in account'
      using errcode = '42501';
  end if;
  if public.is_rimbly_pro_active(new.user_id) then
    return new;
  end if;

  if exists (
    select 1 from public.player_game_stats stats
    where stats.user_id = new.user_id
      and stats.last_activity_date = (now() at time zone 'UTC')::date
  ) then
    quiz_limit := 6;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  select count(*)::integer into quiz_count
  from (
    select attempt.id
    from public.quiz_set_attempts attempt
    where attempt.user_id = new.user_id and attempt.created_at >= utc_day_start
    union all
    select attempt.id
    from public.quiz_attempts attempt
    where attempt.user_id = new.user_id and attempt.created_at >= utc_day_start
  ) attempts;

  if quiz_count >= quiz_limit then
    raise exception 'FREE_QUIZ_DAILY_LIMIT: Free accounts can submit five quizzes per UTC day, plus one bonus quiz after completing the daily goal. Try again tomorrow or upgrade to Rimbly Pro.';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_rimbly_free_battle_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  utc_day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  invite_count integer;
begin
  if auth.role() is distinct from 'service_role'
    and auth.uid() is distinct from new.challenger_id then
    raise exception 'Battle challenges must belong to the signed-in account'
      using errcode = '42501';
  end if;
  if public.is_rimbly_pro_active(new.challenger_id) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.challenger_id::text, 0));
  select count(*)::integer into invite_count
  from public.battle_challenges challenge
  where challenge.challenger_id = new.challenger_id
    and challenge.created_at >= utc_day_start;

  if invite_count >= 3 then
    raise exception 'FREE_BATTLE_DAILY_LIMIT: Free accounts can send three battle invites per UTC day. Try again tomorrow or upgrade to Rimbly Pro.';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_rimbly_free_quiz_limit() from public, anon, authenticated;
revoke all on function public.enforce_rimbly_free_battle_limit() from public, anon, authenticated;

drop trigger if exists enforce_rimbly_quiz_set_limit on public.quiz_set_attempts;
create trigger enforce_rimbly_quiz_set_limit
  before insert on public.quiz_set_attempts
  for each row execute function public.enforce_rimbly_free_quiz_limit();

drop trigger if exists enforce_rimbly_legacy_quiz_limit on public.quiz_attempts;
create trigger enforce_rimbly_legacy_quiz_limit
  before insert on public.quiz_attempts
  for each row execute function public.enforce_rimbly_free_quiz_limit();

drop trigger if exists enforce_rimbly_battle_invite_limit on public.battle_challenges;
create trigger enforce_rimbly_battle_invite_limit
  before insert on public.battle_challenges
  for each row execute function public.enforce_rimbly_free_battle_limit();

drop function if exists public.get_game_leaderboard(text, text);
create function public.get_game_leaderboard(p_university text, p_period text)
returns table (
  user_id uuid,
  full_name text,
  university text,
  points bigint,
  quizzes_completed integer,
  battle_wins integer,
  battle_losses integer,
  current_win_streak integer,
  best_win_streak integer,
  title text,
  is_pro boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  week_start timestamptz := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if p_period not in ('all-time', 'weekly') then
    raise exception 'Choose a supported leaderboard period';
  end if;
  return query
    with weekly_activity as (
      select activity.user_id, sum(activity.points)::bigint as points
      from (
        select attempt.user_id, attempt.correct_count * 10 as points
        from public.quiz_set_attempts attempt
        where attempt.created_at >= week_start
        union all
        select attempt.user_id, attempt.correct_count * 10
        from public.quiz_attempts attempt
        where attempt.created_at >= week_start
        union all
        select submission.user_id,
          submission.correct_count * 10
            + case
                when battle.is_draw then 8
                when battle.winner_id = submission.user_id then 25
                else 0
              end
        from public.battle_challenges battle
        join public.battle_submissions submission on submission.battle_id = battle.id
        where battle.status = 'completed'
          and battle.completed_at >= week_start
      ) activity
      group by activity.user_id
    )
    select profile.id, profile.full_name, profile.university,
      case when p_period = 'weekly' then coalesce(weekly.points, 0)
        else coalesce(stats.points, 0) end,
      coalesce(stats.quizzes_completed, 0),
      coalesce(stats.battle_wins, 0), coalesce(stats.battle_losses, 0),
      coalesce(stats.current_win_streak, 0), coalesce(stats.best_win_streak, 0),
      case
        when coalesce(stats.best_win_streak, 0) >= 10 then 'Campus Legend'
        when coalesce(stats.best_win_streak, 0) >= 5 then 'Grandmaster'
        when coalesce(stats.best_win_streak, 0) >= 3 then 'Elite'
        when coalesce(stats.best_win_streak, 0) >= 1 then 'Contender'
        else 'Rookie'
      end,
      coalesce(subscription.user_id is not null, false)
    from public.profiles profile
    left join public.player_game_stats stats on stats.user_id = profile.id
    left join weekly_activity weekly on weekly.user_id = profile.id
    left join public.rimbly_subscriptions subscription
      on subscription.user_id = profile.id
      and subscription.status = 'active'
      and subscription.expires_at > now()
    where nullif(trim(profile.university), '') is not null
      and (p_university is null or lower(profile.university) = lower(p_university))
      and (
        (p_period = 'all-time' and (
          stats.user_id is not null
          or exists (select 1 from public.quiz_attempts attempt where attempt.user_id = profile.id)
        ))
        or (p_period = 'weekly' and coalesce(weekly.points, 0) > 0)
      )
    order by
      case when p_period = 'weekly' then coalesce(weekly.points, 0)
        else coalesce(stats.points, 0) end desc,
      coalesce(stats.battle_wins, 0) desc,
      coalesce(stats.best_win_streak, 0) desc,
      profile.full_name
    limit 100;
end;
$$;

revoke all on function public.get_game_leaderboard(text, text) from public, anon;
grant execute on function public.get_game_leaderboard(text, text) to authenticated;
