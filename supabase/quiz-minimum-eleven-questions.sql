-- Apply after quiz-audience-targeting.sql and quiz-revisions.sql.
-- Published quizzes must contain at least 11 approved, answerable questions.
begin;

create or replace function public.enforce_minimum_quiz_question_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  approved_question_count integer;
begin
  if tg_op = 'UPDATE' then
    if old.status = 'published' or new.status <> 'published' then
      return new;
    end if;
  elsif new.status <> 'published' then
    return new;
  end if;

  select count(*)::integer into approved_question_count
  from public.quiz_set_questions question
  where question.quiz_id = new.id
    and question.paper_id is not distinct from new.paper_id
    and question.review_status = 'approved'
    and question.correct_index is not null;

  if approved_question_count < 11 then
    raise exception 'A quiz needs at least 11 approved, answerable questions before it can be published';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_minimum_quiz_question_count on public.quiz_sets;
create trigger enforce_minimum_quiz_question_count
before insert or update on public.quiz_sets
for each row execute function public.enforce_minimum_quiz_question_count();

create or replace function public.get_published_quiz_sets_for_current_user()
returns table (
  id uuid,
  title text,
  description text,
  paper_id uuid,
  course_code text,
  course_title text,
  course_department text,
  university text,
  source_file_path text,
  source_file_name text,
  audience_university text,
  audience_department text,
  audience_level text,
  question_count bigint,
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
    select quiz.id, quiz.title, quiz.description, quiz.paper_id,
      course.code, course.title, course.department, course.university,
      coalesce(quiz.source_file_path, paper.file_path),
      coalesce(nullif(quiz.source_file_name, ''), split_part(paper.file_path, '/', 3)),
      quiz.audience_university, quiz.audience_department, quiz.audience_level,
      (select count(*)
       from public.quiz_set_questions question
       where question.quiz_id = quiz.id
         and question.paper_id is not distinct from quiz.paper_id
         and question.review_status = 'approved'
         and question.correct_index is not null),
      quiz.created_at
    from public.quiz_sets quiz
    left join public.papers paper on paper.id = quiz.paper_id
    left join public.courses course on course.id = paper.course_id
    where quiz.status = 'published'
      and (
        select count(*)
        from public.quiz_set_questions question
        where question.quiz_id = quiz.id
          and question.paper_id is not distinct from quiz.paper_id
          and question.review_status = 'approved'
          and question.correct_index is not null
      ) >= 11
    order by quiz.created_at desc;
end;
$$;

create or replace function public.get_quiz_set_questions(p_quiz_id uuid)
returns table (
  id uuid,
  quiz_id uuid,
  paper_id uuid,
  "position" integer,
  prompt text,
  options jsonb,
  explanation text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  approved_question_count integer;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.quiz_sets quiz where quiz.id = p_quiz_id and quiz.status = 'published'
  ) then
    raise exception 'This quiz is not published';
  end if;

  select count(*)::integer into approved_question_count
  from public.quiz_set_questions question
  where question.quiz_id = p_quiz_id
    and question.paper_id is not distinct from (
      select quiz.paper_id from public.quiz_sets quiz where quiz.id = p_quiz_id
    )
    and question.review_status = 'approved'
    and question.correct_index is not null;
  if approved_question_count < 11 then
    raise exception 'This quiz needs at least 11 approved questions before it can be taken';
  end if;

  return query
    select question.id, question.quiz_id, question.paper_id,
      question.position, question.prompt, question.options, question.explanation
    from public.quiz_set_questions question
    where question.quiz_id = p_quiz_id
      and question.paper_id is not distinct from (
        select quiz.paper_id from public.quiz_sets quiz where quiz.id = p_quiz_id
      )
      and question.review_status = 'approved'
      and question.correct_index is not null
    order by question.position, question.id;
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

  select count(*)::integer into question_total
  from public.quiz_set_questions question
  where question.quiz_id = p_quiz_id
    and question.paper_id is not distinct from (
      select quiz.paper_id from public.quiz_sets quiz where quiz.id = p_quiz_id
    )
    and question.review_status = 'approved'
    and question.correct_index is not null;
  if question_total < 11 then
    raise exception 'This quiz needs at least 11 approved questions before it can be submitted';
  end if;
  if (select count(*) from jsonb_object_keys(p_answers)) <> question_total then
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
    order by question.position, question.id
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
    auth.uid(), p_quiz_id,
    round(correct_total::numeric * 100 / question_total)::integer,
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

revoke all on function public.get_published_quiz_sets_for_current_user() from public, anon;
revoke all on function public.get_quiz_set_questions(uuid) from public, anon;
revoke all on function public.submit_quiz_set_attempt(uuid, jsonb, integer) from public, anon;
grant execute on function public.get_published_quiz_sets_for_current_user() to authenticated;
grant execute on function public.get_quiz_set_questions(uuid) to authenticated;
grant execute on function public.submit_quiz_set_attempt(uuid, jsonb, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
