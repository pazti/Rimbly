alter table public.player_game_stats
  add column if not exists current_daily_streak integer not null default 0
    check (current_daily_streak >= 0),
  add column if not exists best_daily_streak integer not null default 0
    check (best_daily_streak >= 0),
  add column if not exists last_activity_date date;

create table if not exists public.player_badges (
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id text not null check (
    badge_id in ('first_win', 'perfect_score', 'speed_demon', 'daily_3', 'daily_7', 'daily_14', 'daily_30')
  ),
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

alter table public.player_badges
  drop constraint if exists player_badges_badge_id_check;
alter table public.player_badges
  add constraint player_badges_badge_id_check
  check (badge_id in (
    'first_win', 'perfect_score', 'speed_demon', 'daily_3', 'daily_7', 'daily_14', 'daily_30'
  ));

alter table public.player_badges enable row level security;
revoke all on public.player_badges from public, anon;
grant select on public.player_badges to authenticated;
drop policy if exists "players read their own badges" on public.player_badges;
create policy "players read their own badges"
on public.player_badges
for select
to authenticated
using (user_id = auth.uid());

insert into public.player_badges (user_id, badge_id)
select stats.user_id, 'first_win'
from public.player_game_stats stats
where stats.battle_wins > 0
on conflict (user_id, badge_id) do nothing;

insert into public.player_badges (user_id, badge_id)
select attempt.user_id, badge.badge_id
from (
  select attempt.user_id, attempt.correct_count, attempt.total_questions, attempt.duration_seconds
  from public.quiz_set_attempts attempt
  union all
  select attempt.user_id, attempt.correct_count, attempt.total_questions, attempt.duration_seconds
  from public.quiz_attempts attempt
) attempt
cross join lateral (
  select 'perfect_score'::text as badge_id
  where attempt.correct_count = attempt.total_questions
  union all
  select 'speed_demon'::text
  where attempt.correct_count = attempt.total_questions
    and attempt.duration_seconds <= attempt.total_questions * 10
) badge
on conflict (user_id, badge_id) do nothing;

insert into public.player_badges (user_id, badge_id)
select submission.user_id, badge.badge_id
from public.battle_submissions submission
cross join lateral (
  select 'perfect_score'::text as badge_id
  where submission.correct_count = submission.total_questions
  union all
  select 'speed_demon'::text
  where submission.correct_count = submission.total_questions
    and submission.duration_seconds <= submission.total_questions * 10
) badge
on conflict (user_id, badge_id) do nothing;

create or replace function public.award_player_badge(p_user_id uuid, p_badge_id text)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.player_badges (user_id, badge_id)
  values (p_user_id, p_badge_id)
  on conflict (user_id, badge_id) do nothing;
$$;

create or replace function public.record_player_daily_activity(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  activity_date date := (now() at time zone 'UTC')::date;
  resulting_streak integer;
begin
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
  return resulting_streak;
end;
$$;

create or replace function public.track_legacy_quiz_points()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.player_game_stats (user_id, points, quizzes_completed)
  values (new.user_id, new.correct_count * 10, 1)
  on conflict (user_id) do update
  set points = public.player_game_stats.points + excluded.points,
      quizzes_completed = public.player_game_stats.quizzes_completed + 1,
      updated_at = now();

  perform public.record_player_daily_activity(new.user_id);
  if new.correct_count = new.total_questions then
    perform public.award_player_badge(new.user_id, 'perfect_score');
    if new.duration_seconds <= new.total_questions * 10 then
      perform public.award_player_badge(new.user_id, 'speed_demon');
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.submit_quiz_set_attempt(
  p_quiz_id uuid,
  p_answers jsonb,
  p_duration_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  quiz_question record;
  question_total integer;
  correct_total integer := 0;
  answer_index integer;
  attempt_id uuid;
  points_earned integer;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Quiz answers are invalid';
  end if;
  if p_duration_seconds is null or p_duration_seconds < 0 or p_duration_seconds > 86400 then
    raise exception 'Quiz answers or duration are invalid';
  end if;
  if not exists (
    select 1 from public.quiz_sets quiz where quiz.id = p_quiz_id and quiz.status = 'published'
  ) then
    raise exception 'This quiz is not published';
  end if;

  select count(*) into question_total
  from public.quiz_set_questions question
  where question.quiz_id = p_quiz_id
    and question.paper_id is not distinct from (
      select quiz.paper_id from public.quiz_sets quiz where quiz.id = p_quiz_id
    )
    and question.review_status = 'approved'
    and question.correct_index is not null;
  if question_total = 0 or (select count(*) from jsonb_object_keys(p_answers)) <> question_total then
    raise exception 'Answer every question before submitting';
  end if;
  for quiz_question in
    select question.id, question.correct_index, question.options
    from public.quiz_set_questions question
    where question.quiz_id = p_quiz_id
      and question.paper_id is not distinct from (
        select quiz.paper_id from public.quiz_sets quiz where quiz.id = p_quiz_id
      )
      and question.review_status = 'approved'
      and question.correct_index is not null
  loop
    if not (p_answers ? quiz_question.id::text)
       or jsonb_typeof(p_answers->quiz_question.id::text) <> 'number'
       or (p_answers->>quiz_question.id::text) !~ '^[0-5]$' then
      raise exception 'An answer is missing or invalid';
    end if;
    answer_index := (p_answers->>quiz_question.id::text)::integer;
    if answer_index >= jsonb_array_length(quiz_question.options) then
      raise exception 'An answer does not match its question options';
    end if;
    if answer_index = quiz_question.correct_index then
      correct_total := correct_total + 1;
    end if;
  end loop;

  insert into public.quiz_set_attempts (
    user_id, quiz_id, score_percent, correct_count, total_questions, duration_seconds, answers
  )
  values (
    auth.uid(), p_quiz_id, round(correct_total::numeric * 100 / question_total)::integer,
    correct_total, question_total, p_duration_seconds, p_answers
  )
  returning id into attempt_id;
  points_earned := correct_total * 10;
  insert into public.player_game_stats (user_id, points, quizzes_completed)
  values (auth.uid(), points_earned, 1)
  on conflict (user_id) do update
  set points = public.player_game_stats.points + excluded.points,
      quizzes_completed = public.player_game_stats.quizzes_completed + 1,
      updated_at = now();

  perform public.record_player_daily_activity(auth.uid());
  if correct_total = question_total then
    perform public.award_player_badge(auth.uid(), 'perfect_score');
    if p_duration_seconds <= question_total * 10 then
      perform public.award_player_badge(auth.uid(), 'speed_demon');
    end if;
  end if;

  return jsonb_build_object(
    'id', attempt_id,
    'paper_id', (select quiz.paper_id from public.quiz_sets quiz where quiz.id = p_quiz_id),
    'quiz_id', p_quiz_id,
    'quiz_title', (select quiz.title from public.quiz_sets quiz where quiz.id = p_quiz_id),
    'score_percent', round(correct_total::numeric * 100 / question_total)::integer,
    'correct_count', correct_total,
    'total_questions', question_total,
    'duration_seconds', p_duration_seconds,
    'created_at', now(),
    'points_earned', points_earned
  );
end;
$$;

create or replace function public.submit_battle_attempt(
  p_battle_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  battle public.battle_challenges%rowtype;
  quiz_question record;
  question_total integer;
  correct_total integer := 0;
  answer_index integer;
  other_submission public.battle_submissions%rowtype;
  this_submission public.battle_submissions%rowtype;
  calculated_winner uuid;
  player_id uuid;
  player_correct_total integer;
  player_bonus_points integer;
  player_points integer;
  winner_streak integer;
  points_earned integer := 0;
  bonus_points integer := 0;
  started_at timestamptz;
  elapsed_seconds double precision;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  select * into battle from public.battle_challenges
  where id = p_battle_id for update;
  if not found or auth.uid() not in (battle.challenger_id, battle.challenged_id) then
    raise exception 'This battle is not available to your account';
  end if;
  if battle.status <> 'active' then
    raise exception 'This battle is not accepting answers';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Battle answers are invalid';
  end if;
  if exists (
    select 1 from public.battle_submissions submission
    where submission.battle_id = p_battle_id and submission.user_id = auth.uid()
  ) then
    raise exception 'You have already submitted this battle';
  end if;
  select start.started_at into started_at
  from public.battle_starts start
  where start.battle_id = p_battle_id and start.user_id = auth.uid();
  if started_at is null then
    raise exception 'Open the battle questions before submitting';
  end if;
  elapsed_seconds := greatest(0, extract(epoch from clock_timestamp() - started_at));
  select cardinality(battle.question_ids) into question_total;
  if (select count(*) from jsonb_object_keys(p_answers)) <> question_total then
    raise exception 'Answer every battle question before submitting';
  end if;
  for quiz_question in
    select question.id, question.correct_index, question.options
    from public.quiz_set_questions question
    where question.id = any(battle.question_ids)
      and question.paper_id is not distinct from (
        select quiz.paper_id from public.quiz_sets quiz where quiz.id = battle.quiz_id
      )
      and question.review_status = 'approved'
      and question.correct_index is not null
  loop
    if not (p_answers ? quiz_question.id::text)
       or jsonb_typeof(p_answers->quiz_question.id::text) <> 'number'
       or (p_answers->>quiz_question.id::text) !~ '^[0-5]$' then
      raise exception 'A battle answer is missing or invalid';
    end if;
    answer_index := (p_answers->>quiz_question.id::text)::integer;
    if answer_index >= jsonb_array_length(quiz_question.options) then
      raise exception 'A battle answer does not match its question options';
    end if;
    if answer_index = quiz_question.correct_index then
      correct_total := correct_total + 1;
    end if;
  end loop;
  insert into public.battle_submissions (
    battle_id, user_id, answers, correct_count, total_questions, duration_seconds
  ) values (
    p_battle_id, auth.uid(), p_answers, correct_total, question_total, elapsed_seconds
  );

  perform public.record_player_daily_activity(auth.uid());
  if correct_total = question_total then
    perform public.award_player_badge(auth.uid(), 'perfect_score');
    if elapsed_seconds <= question_total * 10 then
      perform public.award_player_badge(auth.uid(), 'speed_demon');
    end if;
  end if;

  select * into this_submission from public.battle_submissions
  where battle_id = p_battle_id and user_id = auth.uid();
  select * into other_submission from public.battle_submissions
  where battle_id = p_battle_id and user_id <> auth.uid();
  if other_submission.user_id is not null then
    if this_submission.correct_count > other_submission.correct_count
       or (this_submission.correct_count = other_submission.correct_count
         and this_submission.duration_seconds < other_submission.duration_seconds) then
      calculated_winner := this_submission.user_id;
    elsif other_submission.correct_count > this_submission.correct_count
       or (other_submission.correct_count = this_submission.correct_count
         and other_submission.duration_seconds < this_submission.duration_seconds) then
      calculated_winner := other_submission.user_id;
    end if;
    update public.battle_challenges
    set status = 'completed',
        winner_id = calculated_winner,
        is_draw = calculated_winner is null,
        completed_at = now()
    where id = p_battle_id;
    bonus_points := case
      when calculated_winner is null then 8
      when calculated_winner = auth.uid() then 25
      else 0
    end;
    points_earned := correct_total * 10 + bonus_points;

    foreach player_id in array array[battle.challenger_id, battle.challenged_id]
    loop
      select submission.correct_count into player_correct_total
      from public.battle_submissions submission
      where submission.battle_id = p_battle_id and submission.user_id = player_id;
      player_bonus_points := case
        when calculated_winner is null then 8
        when player_id = calculated_winner then 25
        else 0
      end;
      player_points := player_correct_total * 10 + player_bonus_points;
      insert into public.player_game_stats (
        user_id, points, battles_played, battle_wins, battle_losses,
        current_win_streak, best_win_streak
      )
      values (
        player_id,
        player_points,
        1,
        case when player_id = calculated_winner then 1 else 0 end,
        case when calculated_winner is not null and player_id <> calculated_winner then 1 else 0 end,
        case when player_id = calculated_winner then 1 else 0 end,
        case when player_id = calculated_winner then 1 else 0 end
      )
      on conflict (user_id) do update
      set points = public.player_game_stats.points + excluded.points,
          battles_played = public.player_game_stats.battles_played + 1,
          battle_wins = public.player_game_stats.battle_wins + excluded.battle_wins,
          battle_losses = public.player_game_stats.battle_losses + excluded.battle_losses,
          current_win_streak = case
            when player_id = calculated_winner then public.player_game_stats.current_win_streak + 1
            else 0
          end,
          best_win_streak = greatest(
            public.player_game_stats.best_win_streak,
            case
              when player_id = calculated_winner then public.player_game_stats.current_win_streak + 1
              else 0
            end
          ),
          updated_at = now();

      if player_correct_total = question_total then
        perform public.award_player_badge(player_id, 'perfect_score');
        if (
          select submission.duration_seconds
          from public.battle_submissions submission
          where submission.battle_id = p_battle_id and submission.user_id = player_id
        ) <= question_total * 10 then
          perform public.award_player_badge(player_id, 'speed_demon');
        end if;
      end if;
    end loop;

    if calculated_winner is not null then
      if (select stats.battle_wins from public.player_game_stats stats
          where stats.user_id = calculated_winner) = 1 then
        perform public.award_player_badge(calculated_winner, 'first_win');
      end if;
    end if;
  end if;

  select stats.current_win_streak into winner_streak
  from public.player_game_stats stats where stats.user_id = auth.uid();
  return jsonb_build_object(
    'battle_id', p_battle_id,
    'correct_count', correct_total,
    'total_questions', question_total,
    'duration_seconds', elapsed_seconds,
    'status', case when other_submission.user_id is null then 'waiting_for_opponent' else 'completed' end,
    'winner_id', calculated_winner,
    'is_draw', other_submission.user_id is not null and calculated_winner is null,
    'your_streak', coalesce(winner_streak, 0),
    'points_earned', points_earned
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
  title text
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
      end
    from public.profiles profile
    left join public.player_game_stats stats on stats.user_id = profile.id
    left join weekly_activity weekly on weekly.user_id = profile.id
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

create or replace function public.get_my_game_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  progress public.player_game_stats%rowtype;
  badges jsonb;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  select * into progress from public.player_game_stats stats where stats.user_id = auth.uid();
  select coalesce(
    jsonb_agg(jsonb_build_object('badge_id', badge.badge_id, 'earned_at', badge.earned_at)
      order by badge.earned_at),
    '[]'::jsonb
  )
  into badges
  from public.player_badges badge
  where badge.user_id = auth.uid();

  return jsonb_build_object(
    'points', coalesce(progress.points, 0),
    'quizzes_completed', coalesce(progress.quizzes_completed, 0),
    'battles_played', coalesce(progress.battles_played, 0),
    'battle_wins', coalesce(progress.battle_wins, 0),
    'battle_losses', coalesce(progress.battle_losses, 0),
    'current_win_streak', coalesce(progress.current_win_streak, 0),
    'best_win_streak', coalesce(progress.best_win_streak, 0),
    'current_daily_streak', case
      when progress.last_activity_date >= (now() at time zone 'UTC')::date - 1
        then coalesce(progress.current_daily_streak, 0)
      else 0
    end,
    'best_daily_streak', coalesce(progress.best_daily_streak, 0),
    'title', case
      when coalesce(progress.best_win_streak, 0) >= 10 then 'Campus Legend'
      when coalesce(progress.best_win_streak, 0) >= 5 then 'Grandmaster'
      when coalesce(progress.best_win_streak, 0) >= 3 then 'Elite'
      when coalesce(progress.best_win_streak, 0) >= 1 then 'Contender'
      else 'Rookie'
    end,
    'badges', badges
  );
end;
$$;

with activity_points as (
  select attempt.user_id, attempt.correct_count * 10 as points
  from public.quiz_set_attempts attempt
  union all
  select attempt.user_id, attempt.correct_count * 10
  from public.quiz_attempts attempt
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
),
points_by_user as (
  select activity.user_id, sum(activity.points)::bigint as points
  from activity_points activity
  group by activity.user_id
)
insert into public.player_game_stats (user_id, points)
select points_by_user.user_id, points_by_user.points
from points_by_user
on conflict (user_id) do update
set points = excluded.points,
    updated_at = now();

revoke all on function public.award_player_badge(uuid, text) from public, anon, authenticated;
revoke all on function public.record_player_daily_activity(uuid) from public, anon, authenticated;
revoke all on function public.get_game_leaderboard(text, text) from public, anon;
revoke all on function public.get_my_game_progress() from public, anon;
grant execute on function public.get_game_leaderboard(text, text) to authenticated;
grant execute on function public.get_my_game_progress() to authenticated;

create or replace function public.get_daily_challenge_leaderboard(p_quiz_id uuid)
returns table (
  user_id uuid,
  full_name text,
  score_percent integer,
  correct_count integer,
  total_questions integer,
  duration_seconds integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  utc_day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.quiz_sets quiz
    where quiz.id = p_quiz_id and quiz.status = 'published'
  ) then
    raise exception 'Today’s challenge is no longer published';
  end if;

  return query
    with today_attempts as (
      select attempt.user_id, attempt.score_percent, attempt.correct_count,
        attempt.total_questions, attempt.duration_seconds, attempt.created_at,
        row_number() over (
          partition by attempt.user_id
          order by attempt.score_percent desc, attempt.duration_seconds, attempt.created_at
        ) as user_rank
      from public.quiz_set_attempts attempt
      where attempt.quiz_id = p_quiz_id
        and attempt.created_at >= utc_day_start
        and attempt.total_questions = 10
    )
    select attempt.user_id, profile.full_name, attempt.score_percent,
      attempt.correct_count, attempt.total_questions, attempt.duration_seconds
    from today_attempts attempt
    join public.profiles profile on profile.id = attempt.user_id
    where attempt.user_rank = 1
    order by attempt.correct_count desc, attempt.duration_seconds, attempt.created_at
    limit 10;
end;
$$;

revoke all on function public.get_daily_challenge_leaderboard(uuid) from public, anon;
grant execute on function public.get_daily_challenge_leaderboard(uuid) to authenticated;
