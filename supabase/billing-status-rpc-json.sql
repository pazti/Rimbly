-- Recreate the billing status RPC with the JSONB response consumed by the app.
-- Apply after monetization.sql.
begin;

drop function if exists public.get_my_rimbly_billing_status();

create function public.get_my_rimbly_billing_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  utc_day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  utc_week_start timestamptz := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
  subscription public.rimbly_subscriptions%rowtype;
  latest_payment public.rimbly_billing_payments%rowtype;
  quiz_count integer;
  quiz_week_count integer;
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

  select count(*)::integer into quiz_week_count
  from (
    select attempt.id
    from public.quiz_set_attempts attempt
    where attempt.user_id = current_user_id and attempt.created_at >= utc_week_start
    union all
    select attempt.id
    from public.quiz_attempts attempt
    where attempt.user_id = current_user_id and attempt.created_at >= utc_week_start
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
    'free_quiz_limit', 3,
    'quizzes_used_this_week', coalesce(quiz_week_count, 0),
    'free_quiz_weekly_limit', 3,
    'quiz_week_resets_at', utc_week_start + interval '1 week',
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

notify pgrst, 'reload schema';
commit;
