-- Run after quiz-battles.sql, monetization.sql, and maintenance-mode.sql.
-- Adds university-scoped, seven-day battle links without exposing battle questions.
begin;

alter table public.battle_challenges
  alter column challenged_id drop not null;

drop index if exists public.battle_challenges_open_pair_idx;
create unique index battle_challenges_open_pair_idx
  on public.battle_challenges (
    least(challenger_id, challenged_id),
    greatest(challenger_id, challenged_id)
  )
  where challenged_id is not null
    and status in ('pending', 'active');

create or replace function public.create_open_battle_challenge(p_quiz_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  battle_id uuid;
  shared_questions uuid[];
  player_university text;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  select profile.university into player_university
  from public.profiles profile
  where profile.id = auth.uid();
  if nullif(trim(player_university), '') is null then
    raise exception 'Complete your university profile before creating a battle invite';
  end if;
  if not exists (
    select 1 from public.quiz_sets quiz
    where quiz.id = p_quiz_id and quiz.status = 'published'
  ) then
    raise exception 'Choose a published quiz';
  end if;

  select array_agg(question.id order by question.position) into shared_questions
  from public.quiz_set_questions question
  where question.quiz_id = p_quiz_id
    and question.paper_id is not distinct from (
      select quiz.paper_id from public.quiz_sets quiz where quiz.id = p_quiz_id
    )
    and question.paper_id is not null
    and question.review_status = 'approved'
    and question.correct_index is not null;
  if coalesce(cardinality(shared_questions), 0) = 0 then
    raise exception 'This quiz has no reviewed questions';
  end if;

  insert into public.battle_challenges (
    quiz_id, challenger_id, challenged_id, question_ids
  ) values (
    p_quiz_id, auth.uid(), null, shared_questions
  )
  returning id into battle_id;
  return battle_id;
end;
$$;

create or replace function public.get_open_battle_challenge(p_battle_id uuid)
returns table (
  status text,
  quiz_title text,
  challenger_name text,
  university text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  challenge public.battle_challenges%rowtype;
  challenge_quiz_title text;
  challenge_name text;
  challenge_university text;
  player_university text;
  invite_status text;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  select battle.* into challenge
  from public.battle_challenges battle
  where battle.id = p_battle_id;
  if not found then
    raise exception 'This battle invite could not be found';
  end if;

  select quiz.title, profile.full_name, profile.university
  into challenge_quiz_title, challenge_name, challenge_university
  from public.quiz_sets quiz
  join public.profiles profile on profile.id = challenge.challenger_id
  where quiz.id = challenge.quiz_id;
  if not found then
    raise exception 'This battle invite could not be found';
  end if;

  if auth.uid() = challenge.challenger_id then
    invite_status := case
      when challenge.status = 'cancelled' then 'cancelled'
      when challenge.challenged_id is not null or challenge.status <> 'pending' then 'claimed'
      when challenge.created_at <= now() - interval '7 days' then 'expired'
      else 'owner'
    end;
  else
    if public.current_user_is_suspended_for(auth.uid()) then
      raise exception 'An active signed-in account is required' using errcode = '42501';
    end if;
    select profile.university into player_university
    from public.profiles profile
    where profile.id = auth.uid();
    if nullif(trim(player_university), '') is null
      or lower(player_university) <> lower(coalesce(challenge_university, '')) then
      raise exception 'This invite is only available to students at the challenger’s university';
    end if;

    invite_status := case
      when challenge.status = 'cancelled' then 'cancelled'
      when challenge.challenged_id is not null then 'claimed'
      when challenge.status <> 'pending' then 'claimed'
      when challenge.created_at <= now() - interval '7 days' then 'expired'
      else 'open'
    end;
  end if;

  return query
    select invite_status, challenge_quiz_title,
      coalesce(challenge_name, 'A Rimbly student'), challenge_university;
end;
$$;

create or replace function public.accept_open_battle_challenge(p_battle_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  challenge public.battle_challenges%rowtype;
  challenger_university text;
  player_university text;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  select * into challenge
  from public.battle_challenges battle
  where battle.id = p_battle_id
  for update;
  if not found then
    raise exception 'This battle invite could not be found';
  end if;
  if challenge.challenger_id = auth.uid() then
    raise exception 'You cannot accept your own battle invite';
  end if;
  if challenge.status <> 'pending' or challenge.challenged_id is not null then
    raise exception 'This battle invite has already been claimed or cancelled';
  end if;
  if challenge.created_at <= now() - interval '7 days' then
    raise exception 'This battle invite has expired';
  end if;

  select profile.university into challenger_university
  from public.profiles profile
  where profile.id = challenge.challenger_id;
  select profile.university into player_university
  from public.profiles profile
  where profile.id = auth.uid();
  if nullif(trim(player_university), '') is null
    or lower(player_university) <> lower(coalesce(challenger_university, ''))
    or public.current_user_is_suspended_for(challenge.challenger_id) then
    raise exception 'This invite is only available to active students at the challenger’s university';
  end if;

  if exists (
    select 1
    from public.battle_challenges existing
    where existing.challenged_id is not null
      and existing.status in ('pending', 'active')
      and existing.id <> challenge.id
      and (
        (existing.challenger_id = challenge.challenger_id
          and existing.challenged_id = auth.uid())
        or (existing.challenger_id = auth.uid()
          and existing.challenged_id = challenge.challenger_id)
      )
  ) then
    raise exception 'There is already an open battle between these students';
  end if;

  update public.battle_challenges
  set challenged_id = auth.uid(),
      status = 'active',
      accepted_at = now()
  where id = challenge.id
    and status = 'pending'
    and challenged_id is null;
  if not found then
    raise exception 'This battle invite has already been claimed';
  end if;
end;
$$;

create or replace function public.list_my_battles()
returns table (
  id uuid,
  quiz_id uuid,
  quiz_title text,
  challenger_id uuid,
  challenger_name text,
  challenged_id uuid,
  challenged_name text,
  status text,
  winner_id uuid,
  is_draw boolean,
  your_submission boolean,
  opponent_submission boolean,
  your_correct_count integer,
  opponent_correct_count integer,
  your_duration_seconds double precision,
  opponent_duration_seconds double precision,
  created_at timestamptz
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
    select battle.id, battle.quiz_id, quiz.title,
      battle.challenger_id, challenger.full_name,
      battle.challenged_id, challenged.full_name,
      case
        when battle.status = 'pending'
          and battle.challenged_id is null
          and battle.created_at <= now() - interval '7 days' then 'expired'
        else battle.status
      end,
      battle.winner_id, battle.is_draw,
      exists (
        select 1 from public.battle_submissions submission
        where submission.battle_id = battle.id and submission.user_id = auth.uid()
      ),
      exists (
        select 1 from public.battle_submissions submission
        where submission.battle_id = battle.id
          and submission.user_id <> auth.uid()
          and submission.user_id in (battle.challenger_id, battle.challenged_id)
      ),
      case when battle.status = 'completed' then (
        select submission.correct_count from public.battle_submissions submission
        where submission.battle_id = battle.id and submission.user_id = auth.uid()
      ) end,
      case when battle.status = 'completed' then (
        select submission.correct_count from public.battle_submissions submission
        where submission.battle_id = battle.id
          and submission.user_id <> auth.uid()
          and submission.user_id in (battle.challenger_id, battle.challenged_id)
      ) end,
      case when battle.status = 'completed' then (
        select submission.duration_seconds from public.battle_submissions submission
        where submission.battle_id = battle.id and submission.user_id = auth.uid()
      ) end,
      case when battle.status = 'completed' then (
        select submission.duration_seconds from public.battle_submissions submission
        where submission.battle_id = battle.id
          and submission.user_id <> auth.uid()
          and submission.user_id in (battle.challenger_id, battle.challenged_id)
      ) end,
      battle.created_at
    from public.battle_challenges battle
    join public.quiz_sets quiz on quiz.id = battle.quiz_id
    join public.profiles challenger on challenger.id = battle.challenger_id
    left join public.profiles challenged on challenged.id = battle.challenged_id
    where auth.uid() in (battle.challenger_id, battle.challenged_id)
      and battle.status in ('pending', 'active', 'completed')
    order by battle.created_at desc
    limit 100;
end;
$$;

create index if not exists battle_challenges_completed_at_idx
  on public.battle_challenges (completed_at desc)
  where status = 'completed';

create or replace function public.get_university_battle_activity()
returns table (
  completed_battles_this_week integer,
  recent_battles jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  player_university text;
  battle_count integer;
  recent_activity jsonb;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  select profile.university into player_university
  from public.profiles profile
  where profile.id = auth.uid();
  if nullif(trim(player_university), '') is null then
    return query select null::integer, '[]'::jsonb;
    return;
  end if;

  select count(*)::integer into battle_count
  from public.battle_challenges battle
  join public.profiles challenger on challenger.id = battle.challenger_id
  join public.profiles challenged on challenged.id = battle.challenged_id
  where battle.status = 'completed'
    and battle.completed_at >= now() - interval '7 days'
    and lower(trim(challenger.university)) = lower(trim(player_university))
    and lower(trim(challenged.university)) = lower(trim(player_university));

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'quiz_title', recent.quiz_title,
        'completed_at', recent.completed_at
      )
      order by recent.completed_at desc
    ),
    '[]'::jsonb
  )
  into recent_activity
  from (
    select quiz.title as quiz_title, battle.completed_at
    from public.battle_challenges battle
    join public.profiles challenger on challenger.id = battle.challenger_id
    join public.profiles challenged on challenged.id = battle.challenged_id
    join public.quiz_sets quiz on quiz.id = battle.quiz_id
    where battle.status = 'completed'
      and battle.completed_at >= now() - interval '7 days'
      and lower(trim(challenger.university)) = lower(trim(player_university))
      and lower(trim(challenged.university)) = lower(trim(player_university))
    order by battle.completed_at desc
    limit 3
  ) recent;

  return query
    select case when battle_count >= 3 then battle_count else null end,
      recent_activity;
end;
$$;

revoke all on function public.create_open_battle_challenge(uuid) from public, anon;
revoke all on function public.get_open_battle_challenge(uuid) from public, anon;
revoke all on function public.accept_open_battle_challenge(uuid) from public, anon;
revoke all on function public.list_my_battles() from public, anon;
revoke all on function public.get_university_battle_activity() from public, anon;

grant execute on function public.create_open_battle_challenge(uuid) to authenticated;
grant execute on function public.get_open_battle_challenge(uuid) to authenticated;
grant execute on function public.accept_open_battle_challenge(uuid) to authenticated;
grant execute on function public.list_my_battles() to authenticated;
grant execute on function public.get_university_battle_activity() to authenticated;

notify pgrst, 'reload schema';
commit;
