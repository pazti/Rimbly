-- Apply after gamification.sql, quiz-audience-targeting.sql,
-- harden-submission-workflows.sql, ambassador-program.sql, and monetization.sql.
-- Persist learning missions and award XP only from trusted database events.

begin;

alter table public.player_badges
  drop constraint if exists player_badges_badge_id_check;
alter table public.player_badges
  add constraint player_badges_badge_id_check
  check (badge_id in (
    'first_win',
    'perfect_score',
    'speed_demon',
    'daily_3',
    'daily_7',
    'daily_14',
    'daily_30',
    'first_steps',
    'comeback',
    'helpful_contributor',
    'campus_connector'
  ));

create table if not exists public.player_mission_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id text not null check (
    mission_id in ('daily_quiz', 'weekly_study_days', 'weekly_battle')
  ),
  period_start date not null,
  completed_at timestamptz not null default now(),
  xp_awarded integer not null check (xp_awarded > 0),
  primary key (user_id, mission_id, period_start)
);

create table if not exists public.player_study_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  study_date date not null,
  primary key (user_id, study_date)
);

create index if not exists player_study_days_week_idx
  on public.player_study_days (user_id, study_date desc);

create table if not exists public.player_help_rewards (
  source_type text not null check (
    source_type in ('contribution_approved', 'ambassador_activation')
  ),
  source_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  xp_awarded integer not null check (xp_awarded > 0),
  earned_at timestamptz not null default now(),
  primary key (source_type, source_id)
);

create index if not exists player_help_rewards_user_idx
  on public.player_help_rewards (user_id, earned_at desc);

create table if not exists public.ambassador_payout_accounts (
  user_id uuid primary key references public.ambassador_profiles(user_id) on delete cascade,
  account_name text not null check (char_length(btrim(account_name)) between 2 and 100),
  bank_name text not null check (char_length(btrim(bank_name)) between 2 and 100),
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  updated_at timestamptz not null default now()
);

create table if not exists public.ambassador_payouts (
  id uuid primary key default gen_random_uuid(),
  ambassador_user_id uuid not null references public.ambassador_profiles(user_id) on delete cascade,
  amount_ngn bigint not null check (amount_ngn >= 5000),
  transfer_reference text not null unique check (
    char_length(btrim(transfer_reference)) between 1 and 120
  ),
  payout_date date not null,
  paid_at timestamptz not null default now(),
  paid_by uuid not null references auth.users(id),
  unique (ambassador_user_id, payout_date)
);

create index if not exists ambassador_payouts_user_paid_idx
  on public.ambassador_payouts (ambassador_user_id, paid_at desc);

create table if not exists public.player_streak_recovery_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_count integer not null default 0 check (token_count between 0 and 2),
  eligible_streak integer,
  eligible_date date,
  updated_at timestamptz not null default now(),
  check (
    (eligible_streak is null and eligible_date is null)
    or (
      eligible_streak is not null
      and eligible_streak > 0
      and eligible_date is not null
    )
  )
);

create table if not exists public.player_streak_token_awards (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_date date not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, source_date)
);

create table if not exists public.player_profile_collectibles (
  user_id uuid not null references auth.users(id) on delete cascade,
  collectible_id text not null check (
    collectible_id in ('fresh_frame', 'community_frame', 'focus_theme', 'comeback_theme')
  ),
  category text not null check (category in ('frame', 'theme')),
  earned_at timestamptz not null default now(),
  equipped boolean not null default false,
  primary key (user_id, collectible_id),
  check (
    (collectible_id in ('fresh_frame', 'community_frame') and category = 'frame')
    or (collectible_id in ('focus_theme', 'comeback_theme') and category = 'theme')
  )
);

create unique index if not exists player_profile_collectibles_one_equipped_per_category_idx
  on public.player_profile_collectibles (user_id, category)
  where equipped;

insert into public.player_streak_recovery_state (user_id, token_count)
select stats.user_id, least(stats.best_daily_streak / 7, 2)
from public.player_game_stats stats
where stats.best_daily_streak >= 7
on conflict (user_id) do nothing;

alter table public.player_mission_completions enable row level security;
alter table public.player_study_days enable row level security;
alter table public.player_help_rewards enable row level security;
alter table public.ambassador_payout_accounts enable row level security;
alter table public.ambassador_payouts enable row level security;
alter table public.player_streak_recovery_state enable row level security;
alter table public.player_streak_token_awards enable row level security;
alter table public.player_profile_collectibles enable row level security;
revoke all on public.player_mission_completions, public.player_study_days,
  public.player_help_rewards, public.ambassador_payout_accounts,
  public.ambassador_payouts, public.player_streak_recovery_state,
  public.player_streak_token_awards, public.player_profile_collectibles
  from public, anon, authenticated;

create or replace function public.award_player_badge(p_user_id uuid, p_badge_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  collectible text;
  collectible_category text;
begin
  insert into public.player_badges (user_id, badge_id)
  values (p_user_id, p_badge_id)
  on conflict (user_id, badge_id) do nothing;

  case p_badge_id
    when 'first_steps' then
      collectible := 'fresh_frame';
      collectible_category := 'frame';
    when 'daily_7' then
      collectible := 'focus_theme';
      collectible_category := 'theme';
    when 'comeback' then
      collectible := 'comeback_theme';
      collectible_category := 'theme';
    when 'helpful_contributor' then
      collectible := 'community_frame';
      collectible_category := 'frame';
    when 'campus_connector' then
      collectible := 'community_frame';
      collectible_category := 'frame';
    else
      collectible := null;
      collectible_category := null;
  end case;

  if collectible is not null then
    insert into public.player_profile_collectibles (
      user_id, collectible_id, category
    )
    values (p_user_id, collectible, collectible_category)
    on conflict (user_id, collectible_id) do nothing;
  end if;
end;
$$;

create or replace function public.award_player_streak_recovery_token(
  p_user_id uuid,
  p_source_date date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_tokens integer;
  awarded_date date;
begin
  insert into public.player_streak_recovery_state (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select state.token_count into current_tokens
  from public.player_streak_recovery_state state
  where state.user_id = p_user_id
  for update;

  if current_tokens >= 2 then
    return;
  end if;

  insert into public.player_streak_token_awards (user_id, source_date)
  values (p_user_id, p_source_date)
  on conflict (user_id, source_date) do nothing
  returning source_date into awarded_date;

  if found then
    update public.player_streak_recovery_state
    set token_count = token_count + 1,
        updated_at = now()
    where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.record_player_daily_activity(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  activity_date date := (now() at time zone 'UTC')::date;
  previous_activity_date date;
  previous_streak integer;
  resulting_streak integer;
begin
  select stats.last_activity_date, stats.current_daily_streak
  into previous_activity_date, previous_streak
  from public.player_game_stats stats
  where stats.user_id = p_user_id
  for update;

  if previous_activity_date = activity_date - 2 and previous_streak > 0 then
    insert into public.player_streak_recovery_state (
      user_id, eligible_streak, eligible_date
    )
    values (p_user_id, previous_streak, activity_date)
    on conflict (user_id) do update
    set eligible_streak = excluded.eligible_streak,
        eligible_date = excluded.eligible_date,
        updated_at = now();
  end if;

  insert into public.player_game_stats (
    user_id, last_activity_date, current_daily_streak, best_daily_streak
  )
  values (p_user_id, activity_date, 1, 1)
  on conflict (user_id) do update
  set current_daily_streak = case
        when public.player_game_stats.last_activity_date = activity_date
          then public.player_game_stats.current_daily_streak
        when public.player_game_stats.last_activity_date = activity_date - 1
          then public.player_game_stats.current_daily_streak + 1
        else 1
      end,
      best_daily_streak = greatest(
        public.player_game_stats.best_daily_streak,
        case
          when public.player_game_stats.last_activity_date = activity_date
            then public.player_game_stats.current_daily_streak
          when public.player_game_stats.last_activity_date = activity_date - 1
            then public.player_game_stats.current_daily_streak + 1
          else 1
        end
      ),
      last_activity_date = activity_date,
      updated_at = now()
  returning current_daily_streak into resulting_streak;

  if resulting_streak >= 3 then
    perform public.award_player_badge(p_user_id, 'daily_3');
  end if;
  if resulting_streak >= 7 then
    perform public.award_player_badge(p_user_id, 'daily_7');
  end if;
  if resulting_streak >= 14 then
    perform public.award_player_badge(p_user_id, 'daily_14');
  end if;
  if resulting_streak >= 30 then
    perform public.award_player_badge(p_user_id, 'daily_30');
  end if;
  if resulting_streak >= 7 and resulting_streak % 7 = 0 then
    perform public.award_player_streak_recovery_token(p_user_id, activity_date);
  end if;
  return resulting_streak;
end;
$$;

create or replace function public.award_player_learning_mission(
  p_user_id uuid,
  p_mission_id text,
  p_period_start date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  reward_xp integer;
  awarded_xp integer;
begin
  reward_xp := case p_mission_id
    when 'daily_quiz' then 20
    when 'weekly_study_days' then 50
    when 'weekly_battle' then 30
    else null
  end;
  if p_user_id is null or reward_xp is null or p_period_start is null then
    raise exception 'Learning mission details are invalid';
  end if;

  insert into public.player_mission_completions (
    user_id, mission_id, period_start, xp_awarded
  )
  values (p_user_id, p_mission_id, p_period_start, reward_xp)
  on conflict (user_id, mission_id, period_start) do nothing
  returning xp_awarded into awarded_xp;

  if found then
    insert into public.player_game_stats (user_id, points)
    values (p_user_id, awarded_xp)
    on conflict (user_id) do update
    set points = public.player_game_stats.points + excluded.points,
        updated_at = now();
  end if;
end;
$$;

create or replace function public.award_player_help_reward(
  p_user_id uuid,
  p_source_type text,
  p_source_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  reward_xp integer;
  reward_badge text;
begin
  case p_source_type
    when 'contribution_approved' then
      reward_xp := 50;
      reward_badge := 'helpful_contributor';
    when 'ambassador_activation' then
      reward_xp := 100;
      reward_badge := 'campus_connector';
    else
      raise exception 'Help reward type is invalid';
  end case;
  if p_user_id is null or p_source_id is null then
    raise exception 'Help reward details are invalid';
  end if;

  insert into public.player_help_rewards (
    source_type, source_id, user_id, xp_awarded
  )
  values (p_source_type, p_source_id, p_user_id, reward_xp)
  on conflict (source_type, source_id) do nothing;

  if found then
    insert into public.player_game_stats (user_id, points)
    values (p_user_id, reward_xp)
    on conflict (user_id) do update
    set points = public.player_game_stats.points + excluded.points,
        updated_at = now();
    perform public.award_player_badge(p_user_id, reward_badge);
  end if;
end;
$$;

create or replace function public.record_player_learning_quiz(
  p_user_id uuid,
  p_attempt_id uuid,
  p_quiz_id uuid,
  p_paper_id uuid,
  p_score_percent integer,
  p_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  activity_date date := (p_created_at at time zone 'UTC')::date;
  week_start date;
begin
  if p_user_id is null
    or p_attempt_id is null
    or p_score_percent is null
    or p_score_percent not between 0 and 100 then
    raise exception 'Quiz progress details are invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('learning-rewards:' || p_user_id::text, 0)
  );

  if not exists (
    select 1
    from public.quiz_set_attempts attempt
    where attempt.user_id = p_user_id and attempt.id <> p_attempt_id
    union all
    select 1
    from public.quiz_attempts attempt
    where attempt.user_id = p_user_id and attempt.id <> p_attempt_id
  ) then
    perform public.award_player_badge(p_user_id, 'first_steps');
  end if;

  if (
    select prior.score_percent
    from (
      select attempt.score_percent, attempt.created_at
      from public.quiz_set_attempts attempt
      join public.quiz_sets quiz on quiz.id = attempt.quiz_id
      where attempt.user_id = p_user_id
        and attempt.id <> p_attempt_id
        and attempt.created_at < p_created_at
        and (
          (p_quiz_id is not null and attempt.quiz_id = p_quiz_id)
          or (p_paper_id is not null and quiz.paper_id = p_paper_id)
        )
      union all
      select attempt.score_percent, attempt.created_at
      from public.quiz_attempts attempt
      where attempt.user_id = p_user_id
        and attempt.id <> p_attempt_id
        and attempt.created_at < p_created_at
        and p_paper_id is not null
        and nullif(to_jsonb(attempt)->>'paper_id', '')::uuid = p_paper_id
    ) prior
    order by prior.created_at desc
    limit 1
  ) < p_score_percent then
    perform public.award_player_badge(p_user_id, 'comeback');
  end if;

  perform public.record_player_daily_activity(p_user_id);

  insert into public.player_study_days (user_id, study_date)
  values (p_user_id, activity_date)
  on conflict (user_id, study_date) do nothing;

  if activity_date = (now() at time zone 'UTC')::date then
    perform public.award_player_learning_mission(p_user_id, 'daily_quiz', activity_date);
  end if;

  week_start := date_trunc('week', activity_date::timestamp)::date;
  if week_start = date_trunc('week', (now() at time zone 'UTC'))::date
    and (
      select count(*)
      from public.player_study_days study_day
      where study_day.user_id = p_user_id
        and study_day.study_date >= week_start
        and study_day.study_date < week_start + 7
    ) >= 3 then
    perform public.award_player_learning_mission(
      p_user_id, 'weekly_study_days', week_start
    );
  end if;
end;
$$;

create or replace function public.record_quiz_set_learning_rewards()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.record_player_learning_quiz(
    new.user_id,
    new.id,
    new.quiz_id,
    (select quiz.paper_id from public.quiz_sets quiz where quiz.id = new.quiz_id),
    new.score_percent,
    new.created_at
  );
  return new;
end;
$$;

create or replace function public.record_legacy_quiz_learning_rewards()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.record_player_learning_quiz(
    new.user_id, new.id, null,
    nullif(to_jsonb(new)->>'paper_id', '')::uuid,
    new.score_percent, new.created_at
  );
  return new;
end;
$$;

drop trigger if exists record_learning_rewards_for_quiz_set on public.quiz_set_attempts;
create trigger record_learning_rewards_for_quiz_set
after insert on public.quiz_set_attempts
for each row execute function public.record_quiz_set_learning_rewards();

drop trigger if exists record_learning_rewards_for_legacy_quiz on public.quiz_attempts;
create trigger record_learning_rewards_for_legacy_quiz
after insert on public.quiz_attempts
for each row execute function public.record_legacy_quiz_learning_rewards();

create or replace function public.record_approved_contribution_reward()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.status is distinct from new.status and new.status = 'approved' then
    perform public.award_player_help_reward(
      new.user_id, 'contribution_approved', new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists record_approved_contribution_reward on public.contributions;
create trigger record_approved_contribution_reward
after update of status on public.contributions
for each row execute function public.record_approved_contribution_reward();

create or replace function public.record_ambassador_activation_reward()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.status is distinct from new.status and new.status = 'earned' then
    perform public.award_player_help_reward(
      new.ambassador_user_id, 'ambassador_activation', new.referred_user_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists record_ambassador_activation_reward on public.ambassador_referrals;
create trigger record_ambassador_activation_reward
after update of status on public.ambassador_referrals
for each row execute function public.record_ambassador_activation_reward();

create or replace function public.get_ambassador_dashboard()
returns table (
  invite_code text,
  status text,
  agreed_at timestamptz,
  total_signups bigint,
  total_activated bigint,
  total_earned bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  return query
    select ambassador.invite_code, ambassador.status, ambassador.agreed_at,
      count(referral.referred_user_id)
        filter (where referral.status in ('pending', 'earned'))::bigint,
      count(referral.referred_user_id)
        filter (where referral.status = 'earned')::bigint,
      coalesce(
        sum(referral.reward_amount) filter (where referral.status = 'earned'), 0
      )::bigint
    from public.ambassador_profiles ambassador
    left join public.ambassador_referrals referral
      on referral.ambassador_user_id = ambassador.user_id
    where ambassador.user_id = auth.uid()
    group by ambassador.user_id;
end;
$$;

create or replace function public.get_my_ambassador_payout_summary()
returns table (
  account_name text,
  bank_name text,
  account_number text,
  account_updated_at timestamptz,
  total_earned bigint,
  total_paid bigint,
  available_balance bigint,
  minimum_payout bigint,
  payout_window_open boolean,
  next_payout_date date
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  local_date date := (now() at time zone 'Africa/Lagos')::date;
  local_day integer := extract(dow from now() at time zone 'Africa/Lagos')::integer;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  return query
    select payout_account.account_name,
      payout_account.bank_name,
      payout_account.account_number,
      payout_account.updated_at,
      coalesce(earned.total_earned, 0)::bigint,
      coalesce(paid.total_paid, 0)::bigint,
      greatest(coalesce(earned.total_earned, 0) - coalesce(paid.total_paid, 0), 0)::bigint,
      5000::bigint,
      local_day = 0,
      local_date + case when local_day = 0 then 0 else 7 - local_day end
    from public.ambassador_profiles ambassador
    left join public.ambassador_payout_accounts payout_account
      on payout_account.user_id = ambassador.user_id
    left join lateral (
      select coalesce(
        sum(referral.reward_amount) filter (where referral.status = 'earned'), 0
      )::bigint as total_earned
      from public.ambassador_referrals referral
      where referral.ambassador_user_id = ambassador.user_id
    ) earned on true
    left join lateral (
      select coalesce(sum(payout.amount_ngn), 0)::bigint as total_paid
      from public.ambassador_payouts payout
      where payout.ambassador_user_id = ambassador.user_id
    ) paid on true
    where ambassador.user_id = auth.uid();
end;
$$;

create or replace function public.save_my_ambassador_payout_account(
  p_account_name text,
  p_bank_name text,
  p_account_number text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_account_name text := nullif(btrim(coalesce(p_account_name, '')), '');
  normalized_bank_name text := nullif(btrim(coalesce(p_bank_name, '')), '');
  normalized_account_number text := btrim(coalesce(p_account_number, ''));
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if normalized_account_name is null
    or char_length(normalized_account_name) not between 2 and 100
    or normalized_bank_name is null
    or char_length(normalized_bank_name) not between 2 and 100
    or normalized_account_number !~ '^[0-9]{10}$' then
    raise exception 'Enter an account name, bank name, and 10-digit account number';
  end if;
  if not exists (
    select 1
    from public.ambassador_profiles ambassador
    where ambassador.user_id = auth.uid()
  ) then
    raise exception 'Join the ambassador program before adding payout details';
  end if;

  insert into public.ambassador_payout_accounts (
    user_id, account_name, bank_name, account_number, updated_at
  )
  values (
    auth.uid(), normalized_account_name, normalized_bank_name,
    normalized_account_number, now()
  )
  on conflict (user_id) do update
  set account_name = excluded.account_name,
      bank_name = excluded.bank_name,
      account_number = excluded.account_number,
      updated_at = now();
end;
$$;

drop function if exists public.admin_list_ambassador_payouts();
create function public.admin_list_ambassador_payouts()
returns table (
  user_id uuid,
  full_name text,
  email text,
  invite_code text,
  status text,
  agreed_at timestamptz,
  total_signups bigint,
  total_activated bigint,
  total_earned bigint,
  payout_account_name text,
  payout_bank_name text,
  payout_account_number text,
  payout_account_updated_at timestamptz,
  total_paid bigint,
  last_paid_at timestamptz,
  last_transfer_reference text,
  available_balance bigint,
  payout_eligible boolean,
  payout_window_open boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or public.current_user_is_suspended() or not exists (
    select 1
    from public.admin_memberships membership
    where membership.user_id = auth.uid()
      and membership.role_id = 'super_admin'
      and membership.status = 'active'
  ) then
    raise exception 'Super Admin access is required' using errcode = '42501';
  end if;

  return query
    with referral_totals as (
      select referral.ambassador_user_id,
        count(referral.referred_user_id)
          filter (where referral.status in ('pending', 'earned'))::bigint as total_signups,
        count(referral.referred_user_id)
          filter (where referral.status = 'earned')::bigint as total_activated,
        coalesce(
          sum(referral.reward_amount) filter (where referral.status = 'earned'), 0
        )::bigint as total_earned
      from public.ambassador_referrals referral
      group by referral.ambassador_user_id
    ),
    payout_totals as (
      select payout.ambassador_user_id,
        coalesce(sum(payout.amount_ngn), 0)::bigint as total_paid,
        max(payout.paid_at) as last_paid_at
      from public.ambassador_payouts payout
      group by payout.ambassador_user_id
    )
    select ambassador.user_id::uuid,
      coalesce(profile.full_name, 'Student')::text,
      coalesce(account.email, '')::text,
      ambassador.invite_code::text,
      ambassador.status::text,
      ambassador.agreed_at::timestamptz,
      coalesce(referral.total_signups, 0)::bigint,
      coalesce(referral.total_activated, 0)::bigint,
      coalesce(referral.total_earned, 0)::bigint,
      payout_account.account_name::text,
      payout_account.bank_name::text,
      payout_account.account_number::text,
      payout_account.updated_at::timestamptz,
      coalesce(payout.total_paid, 0)::bigint,
      payout.last_paid_at::timestamptz,
      (
        select latest_payout.transfer_reference
        from public.ambassador_payouts latest_payout
        where latest_payout.ambassador_user_id = ambassador.user_id
        order by latest_payout.paid_at desc
        limit 1
      )::text,
      greatest(
        coalesce(referral.total_earned, 0) - coalesce(payout.total_paid, 0), 0
      )::bigint,
      greatest(
        coalesce(referral.total_earned, 0) - coalesce(payout.total_paid, 0), 0
      ) >= 5000,
      extract(dow from now() at time zone 'Africa/Lagos')::integer = 0
    from public.ambassador_profiles ambassador
    left join public.profiles profile on profile.id = ambassador.user_id
    left join auth.users account on account.id = ambassador.user_id
    left join referral_totals referral on referral.ambassador_user_id = ambassador.user_id
    left join payout_totals payout on payout.ambassador_user_id = ambassador.user_id
    left join public.ambassador_payout_accounts payout_account
      on payout_account.user_id = ambassador.user_id
    order by ambassador.agreed_at desc;
end;
$$;

create or replace function public.record_ambassador_payout(
  p_ambassador_user_id uuid,
  p_transfer_reference text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  local_date date := (now() at time zone 'Africa/Lagos')::date;
  local_day integer := extract(dow from now() at time zone 'Africa/Lagos')::integer;
  earned_amount bigint;
  paid_amount bigint;
  payout_amount bigint;
  payout_id uuid;
  normalized_reference text := nullif(btrim(coalesce(p_transfer_reference, '')), '');
begin
  if auth.uid() is null or public.current_user_is_suspended() or not exists (
    select 1
    from public.admin_memberships membership
    where membership.user_id = auth.uid()
      and membership.role_id = 'super_admin'
      and membership.status = 'active'
  ) then
    raise exception 'Super Admin access is required' using errcode = '42501';
  end if;
  if local_day <> 0 then
    raise exception 'Ambassador payouts can only be recorded on Sunday (Africa/Lagos time)';
  end if;
  if normalized_reference is null or char_length(normalized_reference) > 120 then
    raise exception 'Enter the transfer reference after completing the bank transfer';
  end if;
  if not exists (
    select 1
    from public.ambassador_profiles ambassador
    where ambassador.user_id = p_ambassador_user_id
  ) then
    raise exception 'Ambassador account not found';
  end if;
  if not exists (
    select 1
    from public.ambassador_payout_accounts payout_account
    where payout_account.user_id = p_ambassador_user_id
  ) then
    raise exception 'The ambassador has not added payout account details';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ambassador-payout:' || p_ambassador_user_id::text, 0)
  );

  if exists (
    select 1
    from public.ambassador_payouts payout
    where payout.ambassador_user_id = p_ambassador_user_id
      and payout.payout_date = local_date
  ) then
    raise exception 'A payout has already been recorded for this ambassador today';
  end if;

  select coalesce(
    sum(referral.reward_amount) filter (where referral.status = 'earned'), 0
  )::bigint
  into earned_amount
  from public.ambassador_referrals referral
  where referral.ambassador_user_id = p_ambassador_user_id;

  select coalesce(sum(payout.amount_ngn), 0)::bigint
  into paid_amount
  from public.ambassador_payouts payout
  where payout.ambassador_user_id = p_ambassador_user_id;

  payout_amount := earned_amount - paid_amount;
  if payout_amount < 5000 then
    raise exception 'The ambassador has not reached the ₦5,000 minimum payout';
  end if;

  insert into public.ambassador_payouts (
    ambassador_user_id, amount_ngn, transfer_reference, payout_date, paid_by
  )
  values (
    p_ambassador_user_id, payout_amount, normalized_reference, local_date, auth.uid()
  )
  returning id into payout_id;

  insert into public.admin_audit_logs (
    actor_id, action, resource_type, resource_id, details
  )
  values (
    auth.uid(),
    'ambassador.payout_recorded',
    'ambassador_payout',
    payout_id::text,
    jsonb_build_object(
      'ambassador_user_id', p_ambassador_user_id,
      'amount_ngn', payout_amount,
      'transfer_reference', normalized_reference,
      'payout_date', local_date
    )
  );

  return payout_amount;
end;
$$;

create or replace function public.record_weekly_battle_mission()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  week_start date;
begin
  if old.status is distinct from new.status
    and new.status = 'completed'
    and new.winner_id is not null then
    week_start := date_trunc('week', (new.completed_at at time zone 'UTC'))::date;
    if week_start = date_trunc('week', (now() at time zone 'UTC'))::date then
      perform public.award_player_learning_mission(
        new.winner_id, 'weekly_battle', week_start
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists record_weekly_battle_mission on public.battle_challenges;
create trigger record_weekly_battle_mission
after update of status on public.battle_challenges
for each row execute function public.record_weekly_battle_mission();

create or replace function public.use_streak_recovery_token()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  today_utc date := (now() at time zone 'UTC')::date;
  recovery public.player_streak_recovery_state%rowtype;
  stats public.player_game_stats%rowtype;
  restored_streak integer;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('learning-rewards:' || auth.uid()::text, 0)
  );

  select * into recovery
  from public.player_streak_recovery_state state
  where state.user_id = auth.uid()
  for update;
  if not found or recovery.token_count < 1 then
    raise exception 'You do not have a streak recovery token available';
  end if;
  if recovery.eligible_date is distinct from today_utc
    or recovery.eligible_streak is null then
    raise exception 'A streak can only be recovered on the day you return to study';
  end if;

  select * into stats
  from public.player_game_stats player_stats
  where player_stats.user_id = auth.uid()
  for update;
  if not found or stats.last_activity_date is distinct from today_utc
    or stats.current_daily_streak <> 1 then
    raise exception 'Complete a study session today before recovering your streak';
  end if;

  restored_streak := recovery.eligible_streak + 2;
  update public.player_game_stats
  set current_daily_streak = restored_streak,
      best_daily_streak = greatest(best_daily_streak, restored_streak),
      updated_at = now()
  where user_id = auth.uid();
  update public.player_streak_recovery_state
  set token_count = token_count - 1,
      eligible_streak = null,
      eligible_date = null,
      updated_at = now()
  where user_id = auth.uid();

  if restored_streak >= 3 then
    perform public.award_player_badge(auth.uid(), 'daily_3');
  end if;
  if restored_streak >= 7 then
    perform public.award_player_badge(auth.uid(), 'daily_7');
  end if;
  if restored_streak >= 14 then
    perform public.award_player_badge(auth.uid(), 'daily_14');
  end if;
  if restored_streak >= 30 then
    perform public.award_player_badge(auth.uid(), 'daily_30');
  end if;
  if restored_streak >= 7 and restored_streak % 7 = 0 then
    perform public.award_player_streak_recovery_token(auth.uid(), today_utc);
  end if;

  return jsonb_build_object(
    'current_daily_streak', restored_streak,
    'tokens_remaining', (
      select state.token_count
      from public.player_streak_recovery_state state
      where state.user_id = auth.uid()
    )
  );
end;
$$;

create or replace function public.set_profile_collectible(p_collectible_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  collectible_category text;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('profile-collectibles:' || auth.uid()::text, 0)
  );

  if p_collectible_id is null then
    update public.player_profile_collectibles
    set equipped = false
    where user_id = auth.uid()
      and equipped;
    return jsonb_build_object('collectible_id', null, 'equipped', false);
  end if;

  select collectible.category into collectible_category
  from public.player_profile_collectibles collectible
  where collectible.user_id = auth.uid()
    and collectible.collectible_id = p_collectible_id
  for update;
  if not found then
    raise exception 'That profile collectible has not been earned';
  end if;

  update public.player_profile_collectibles
  set equipped = false
  where user_id = auth.uid()
    and category = collectible_category
    and equipped;
  update public.player_profile_collectibles
  set equipped = true
  where user_id = auth.uid()
    and collectible_id = p_collectible_id;

  return jsonb_build_object(
    'collectible_id', p_collectible_id,
    'category', collectible_category,
    'equipped', true
  );
end;
$$;

insert into public.player_study_days (user_id, study_date)
select attempt.user_id, (attempt.created_at at time zone 'UTC')::date
from public.quiz_set_attempts attempt
union
select attempt.user_id, (attempt.created_at at time zone 'UTC')::date
from public.quiz_attempts attempt
on conflict (user_id, study_date) do nothing;

insert into public.player_badges (user_id, badge_id)
select attempt.user_id, 'first_steps'
from public.quiz_set_attempts attempt
union
select attempt.user_id, 'first_steps'
from public.quiz_attempts attempt
on conflict (user_id, badge_id) do nothing;

with quiz_history as (
  select attempt.user_id, attempt.quiz_id, quiz.paper_id,
    attempt.score_percent, attempt.created_at
  from public.quiz_set_attempts attempt
  join public.quiz_sets quiz on quiz.id = attempt.quiz_id
  union all
  select attempt.user_id, null::uuid,
    nullif(to_jsonb(attempt)->>'paper_id', '')::uuid,
    attempt.score_percent, attempt.created_at
  from public.quiz_attempts attempt
)
insert into public.player_badges (user_id, badge_id)
select distinct current_attempt.user_id, 'comeback'
from quiz_history current_attempt
cross join lateral (
  select previous_attempt.score_percent
  from quiz_history previous_attempt
  where previous_attempt.user_id = current_attempt.user_id
    and previous_attempt.created_at < current_attempt.created_at
    and (
      (
        current_attempt.quiz_id is not null
        and previous_attempt.quiz_id = current_attempt.quiz_id
      )
      or (
        current_attempt.paper_id is not null
        and previous_attempt.paper_id = current_attempt.paper_id
      )
    )
  order by previous_attempt.created_at desc
  limit 1
) previous_attempt
where current_attempt.score_percent > previous_attempt.score_percent
on conflict (user_id, badge_id) do nothing;

insert into public.player_badges (user_id, badge_id)
select contribution.user_id, 'helpful_contributor'
from public.contributions contribution
where contribution.status = 'approved'
union
select referral.ambassador_user_id, 'campus_connector'
from public.ambassador_referrals referral
where referral.status = 'earned'
on conflict (user_id, badge_id) do nothing;

insert into public.player_profile_collectibles (user_id, collectible_id, category)
select badge.user_id,
  case badge.badge_id
    when 'first_steps' then 'fresh_frame'
    when 'daily_7' then 'focus_theme'
    when 'comeback' then 'comeback_theme'
    else 'community_frame'
  end,
  case
    when badge.badge_id in ('first_steps', 'helpful_contributor', 'campus_connector')
      then 'frame'
    else 'theme'
  end
from public.player_badges badge
where badge.badge_id in (
  'first_steps', 'daily_7', 'comeback', 'helpful_contributor', 'campus_connector'
)
on conflict (user_id, collectible_id) do nothing;

do $$
declare
  activity record;
  today_utc date := (now() at time zone 'UTC')::date;
  week_start date := date_trunc('week', (now() at time zone 'UTC'))::date;
begin
  for activity in
    select study_day.user_id
    from public.player_study_days study_day
    where study_day.study_date >= week_start
      and study_day.study_date < week_start + 7
    group by study_day.user_id
    having count(*) >= 3
  loop
    perform public.award_player_learning_mission(
      activity.user_id, 'weekly_study_days', week_start
    );
  end loop;

  for activity in
    select distinct attempt.user_id
    from public.quiz_set_attempts attempt
    where (attempt.created_at at time zone 'UTC')::date = today_utc
    union
    select distinct attempt.user_id
    from public.quiz_attempts attempt
    where (attempt.created_at at time zone 'UTC')::date = today_utc
  loop
    perform public.award_player_learning_mission(
      activity.user_id, 'daily_quiz', today_utc
    );
  end loop;

  for activity in
    select battle.winner_id as user_id
    from public.battle_challenges battle
    where battle.status = 'completed'
      and battle.winner_id is not null
      and battle.completed_at >= (week_start::timestamp at time zone 'UTC')
      and battle.completed_at < ((week_start + 7)::timestamp at time zone 'UTC')
  loop
    perform public.award_player_learning_mission(
      activity.user_id, 'weekly_battle', week_start
    );
  end loop;
end;
$$;

create or replace function public.get_my_learning_missions()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  today_utc date := (now() at time zone 'UTC')::date;
  week_start date := date_trunc('week', (now() at time zone 'UTC'))::date;
  daily_completion public.player_mission_completions%rowtype;
  study_completion public.player_mission_completions%rowtype;
  battle_completion public.player_mission_completions%rowtype;
  recovery_state public.player_streak_recovery_state%rowtype;
  study_day_count integer;
  collectibles jsonb;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  select * into daily_completion
  from public.player_mission_completions mission
  where mission.user_id = auth.uid()
    and mission.mission_id = 'daily_quiz'
    and mission.period_start = today_utc;

  select * into study_completion
  from public.player_mission_completions mission
  where mission.user_id = auth.uid()
    and mission.mission_id = 'weekly_study_days'
    and mission.period_start = week_start;

  select * into battle_completion
  from public.player_mission_completions mission
  where mission.user_id = auth.uid()
    and mission.mission_id = 'weekly_battle'
    and mission.period_start = week_start;

  select count(*)::integer into study_day_count
  from public.player_study_days study_day
  where study_day.user_id = auth.uid()
    and study_day.study_date >= week_start
    and study_day.study_date < week_start + 7;

  select * into recovery_state
  from public.player_streak_recovery_state recovery
  where recovery.user_id = auth.uid();

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'collectible_id', collectible.collectible_id,
        'category', collectible.category,
        'earned_at', collectible.earned_at,
        'equipped', collectible.equipped
      )
      order by collectible.category, collectible.collectible_id
    ),
    '[]'::jsonb
  )
  into collectibles
  from public.player_profile_collectibles collectible
  where collectible.user_id = auth.uid();

  return jsonb_build_object(
    'daily_quiz', jsonb_build_object(
      'completed', daily_completion.user_id is not null,
      'progress', case when daily_completion.user_id is null then 0 else 1 end,
      'target', 1,
      'xp_reward', 20,
      'xp_earned', coalesce(daily_completion.xp_awarded, 0),
      'completed_at', daily_completion.completed_at
    ),
    'weekly_study_days', jsonb_build_object(
      'completed', study_completion.user_id is not null,
      'progress', least(study_day_count, 3),
      'target', 3,
      'xp_reward', 50,
      'xp_earned', coalesce(study_completion.xp_awarded, 0),
      'completed_at', study_completion.completed_at
    ),
    'weekly_battle', jsonb_build_object(
      'completed', battle_completion.user_id is not null,
      'progress', case when battle_completion.user_id is null then 0 else 1 end,
      'target', 1,
      'xp_reward', 30,
      'xp_earned', coalesce(battle_completion.xp_awarded, 0),
      'completed_at', battle_completion.completed_at
    ),
    'streak_recovery', jsonb_build_object(
      'tokens', coalesce(recovery_state.token_count, 0),
      'eligible', coalesce(recovery_state.eligible_date = today_utc, false),
      'can_recover', coalesce(recovery_state.eligible_date = today_utc, false)
        and coalesce(recovery_state.token_count, 0) > 0,
      'eligible_streak_days', coalesce(recovery_state.eligible_streak, 0)
    ),
    'collectibles', collectibles
  );
end;
$$;

drop function if exists public.get_game_leaderboard(text);
drop function if exists public.get_game_leaderboard(text, text);
create or replace function public.get_game_leaderboard(p_university text, p_period text)
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
  if p_period is null or p_period not in ('all-time', 'weekly') then
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
        union all
        select mission.user_id, mission.xp_awarded
        from public.player_mission_completions mission
        where mission.completed_at >= week_start
        union all
        select reward.user_id, reward.xp_awarded
        from public.player_help_rewards reward
        where reward.earned_at >= week_start
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

revoke all on function public.award_player_learning_mission(uuid, text, date)
  from public, anon, authenticated;
revoke all on function public.award_player_badge(uuid, text)
  from public, anon, authenticated;
revoke all on function public.record_player_daily_activity(uuid)
  from public, anon, authenticated;
revoke all on function public.award_player_streak_recovery_token(uuid, date)
  from public, anon, authenticated;
revoke all on function public.award_player_help_reward(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.record_player_learning_quiz(uuid, uuid, uuid, uuid, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.record_quiz_set_learning_rewards()
  from public, anon, authenticated;
revoke all on function public.record_legacy_quiz_learning_rewards()
  from public, anon, authenticated;
revoke all on function public.record_approved_contribution_reward()
  from public, anon, authenticated;
revoke all on function public.record_ambassador_activation_reward()
  from public, anon, authenticated;
revoke all on function public.record_weekly_battle_mission()
  from public, anon, authenticated;
revoke all on function public.use_streak_recovery_token()
  from public, anon;
revoke all on function public.set_profile_collectible(text)
  from public, anon;
revoke all on function public.get_my_learning_missions() from public, anon;
revoke all on function public.get_game_leaderboard(text, text) from public, anon;
revoke all on function public.get_my_ambassador_payout_summary() from public, anon;
revoke all on function public.save_my_ambassador_payout_account(text, text, text)
  from public, anon;
revoke all on function public.admin_list_ambassador_payouts() from public, anon;
revoke all on function public.record_ambassador_payout(uuid, text) from public, anon;
grant execute on function public.get_my_learning_missions() to authenticated;
grant execute on function public.use_streak_recovery_token() to authenticated;
grant execute on function public.set_profile_collectible(text) to authenticated;
grant execute on function public.get_game_leaderboard(text, text) to authenticated;
grant execute on function public.get_my_ambassador_payout_summary() to authenticated;
grant execute on function public.save_my_ambassador_payout_account(text, text, text)
  to authenticated;
grant execute on function public.admin_list_ambassador_payouts() to authenticated;
grant execute on function public.record_ambassador_payout(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
