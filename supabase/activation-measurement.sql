-- Run after admin-foundation.sql, admin-management.sql, and quiz-battles.sql.
-- Measures the first reviewed-quiz score and answer-review view for new signups.
-- Stores an internal account ID for deduplication, but no names or answer content.
begin;

create table if not exists public.rimbly_activation_config (
  singleton boolean primary key default true check (singleton),
  tracking_started_at timestamptz not null default now()
);

insert into public.rimbly_activation_config (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.rimbly_activation_events (
  user_id uuid primary key references auth.users(id) on delete cascade,
  quiz_id uuid not null references public.quiz_sets(id) on delete restrict,
  activated_at timestamptz not null,
  seconds_to_activation bigint not null check (seconds_to_activation >= 0)
);

alter table public.rimbly_activation_config enable row level security;
alter table public.rimbly_activation_events enable row level security;
revoke all on public.rimbly_activation_config from public, anon, authenticated;
revoke all on public.rimbly_activation_events from public, anon, authenticated;

drop trigger if exists record_first_reviewed_quiz_activation on public.quiz_set_attempts;
drop function if exists public.record_first_reviewed_quiz_activation();

create or replace function public.record_reviewed_quiz_activation(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  account_created_at timestamptz;
  tracking_started_at timestamptz;
  attempt_quiz_id uuid;
  review_loaded_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  select attempt.quiz_id, account.created_at
  into attempt_quiz_id, account_created_at
  from public.quiz_set_attempts attempt
  join auth.users account on account.id = attempt.user_id
  where attempt.id = p_attempt_id
    and attempt.user_id = auth.uid();
  if not found then
    raise exception 'This quiz attempt is not available to your account' using errcode = '42501';
  end if;

  select config.tracking_started_at
  into tracking_started_at
  from public.rimbly_activation_config config
  where config.singleton;
  if not found then
    raise exception 'Activation measurement has not been configured';
  end if;
  if account_created_at < tracking_started_at then
    return;
  end if;

  insert into public.rimbly_activation_events (
    user_id, quiz_id, activated_at, seconds_to_activation
  )
  values (
    auth.uid(),
    attempt_quiz_id,
    review_loaded_at,
    greatest(
      0,
      round(extract(epoch from (review_loaded_at - account_created_at))::numeric)::bigint
    )
  )
  on conflict (user_id) do update
  set quiz_id = excluded.quiz_id,
      activated_at = excluded.activated_at,
      seconds_to_activation = excluded.seconds_to_activation
  where excluded.activated_at < rimbly_activation_events.activated_at;
end;
$$;

revoke all on function public.record_reviewed_quiz_activation(uuid) from public, anon;
grant execute on function public.record_reviewed_quiz_activation(uuid) to authenticated;

create or replace function public.admin_get_activation_metrics()
returns table (
  total_signups bigint,
  activated_students bigint,
  activation_rate_percent numeric,
  median_seconds_to_activation numeric,
  under_90_seconds_percent numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.has_admin_permission('analytics.view') then
    raise exception 'Analytics permission is required' using errcode = '42501';
  end if;

  return query
    with tracking as (
      select config.tracking_started_at
      from public.rimbly_activation_config config
      where config.singleton
    ),
    cohort as (
      select count(*)::bigint as signup_count
      from auth.users account
      cross join tracking
      where account.created_at >= tracking.tracking_started_at
        and account.created_at <= now() - interval '90 seconds'
    ),
    activations as (
      select event.user_id, event.seconds_to_activation
      from public.rimbly_activation_events event
      join auth.users account on account.id = event.user_id
      cross join tracking
      where account.created_at >= tracking.tracking_started_at
        and account.created_at <= now() - interval '90 seconds'
    )
    select cohort.signup_count,
      count(activation.user_id)::bigint,
      coalesce(
        round(count(activation.user_id)::numeric * 100 / nullif(cohort.signup_count, 0), 1),
        0
      ),
      (
        select percentile_cont(0.5) within group (
          order by item.seconds_to_activation::double precision
        )::numeric
        from activations item
      ),
      round(
        (count(activation.user_id) filter (
          where activation.seconds_to_activation <= 90
        ))::numeric * 100 / nullif(count(activation.user_id), 0),
        1
      )
    from cohort
    left join activations activation on true
    group by cohort.signup_count;
end;
$$;

revoke all on function public.admin_get_activation_metrics() from public, anon;
grant execute on function public.admin_get_activation_metrics() to authenticated;

notify pgrst, 'reload schema';
commit;
