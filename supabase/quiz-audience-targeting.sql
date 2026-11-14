-- Apply after quiz-battles.sql through the project's authorized Supabase migration workflow.
-- Audience fields are descriptive labels only; they never restrict quiz visibility.
-- Source papers are optional for manual quizzes. Paper-backed quizzes keep their source review.

begin;

alter table public.quiz_sets
  add column if not exists audience_university text,
  add column if not exists audience_department text,
  add column if not exists audience_level text;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quiz_sets' and column_name = 'target_university'
  ) then
    execute 'update public.quiz_sets set audience_university = coalesce(audience_university, target_university)';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quiz_sets' and column_name = 'target_department'
  ) then
    execute 'update public.quiz_sets set audience_department = coalesce(audience_department, target_department)';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quiz_sets' and column_name = 'target_level'
  ) then
    execute 'update public.quiz_sets set audience_level = coalesce(audience_level, target_level)';
  end if;
end;
$$;

alter table public.quiz_set_questions
  alter column paper_id drop not null;

comment on column public.quiz_sets.audience_university is
  'Descriptive quiz audience label; does not restrict who can view or take the quiz.';
comment on column public.quiz_sets.audience_department is
  'Descriptive quiz audience label; does not restrict who can view or take the quiz.';
comment on column public.quiz_sets.audience_level is
  'Descriptive quiz audience label; does not restrict who can view or take the quiz.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quiz_sets_audience_university_length_check'
      and conrelid = 'public.quiz_sets'::regclass
  ) then
    alter table public.quiz_sets
      add constraint quiz_sets_audience_university_length_check
      check (audience_university is null or length(audience_university) between 1 and 200);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'quiz_sets_audience_department_length_check'
      and conrelid = 'public.quiz_sets'::regclass
  ) then
    alter table public.quiz_sets
      add constraint quiz_sets_audience_department_length_check
      check (audience_department is null or length(audience_department) between 1 and 120);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'quiz_sets_audience_level_check'
      and conrelid = 'public.quiz_sets'::regclass
  ) then
    alter table public.quiz_sets
      add constraint quiz_sets_audience_level_check
      check (audience_level is null or audience_level in (
        '100 Level', '200 Level', '300 Level', '400 Level', '500 Level'
      ));
  end if;
end;
$$;

create or replace function public.admin_save_quiz_draft(
  p_quiz_id uuid,
  p_title text,
  p_description text,
  p_paper_id uuid,
  p_questions jsonb,
  p_source_file_path text,
  p_source_file_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  saved_quiz_id uuid;
  question_data jsonb;
  question_position integer := 0;
  option_count integer;
  correct_answer integer;
  prompt_text text;
  option_values jsonb;
  explanation_text text;
  question_review_status text;
  reviewer_edit boolean := false;
begin
  if p_quiz_id is null and not public.has_admin_permission('quiz.manage') then
    raise exception 'Quiz management permission is required' using errcode = '42501';
  end if;
  if not (public.has_admin_permission('quiz.manage') or public.has_admin_permission('quiz.review')) then
    raise exception 'Quiz access permission is required' using errcode = '42501';
  end if;
  if public.current_user_is_suspended() then
    raise exception 'This account is suspended' using errcode = '42501';
  end if;
  if nullif(trim(p_title), '') is null or length(trim(p_title)) > 160 then
    raise exception 'Quiz title is required and must be 160 characters or fewer';
  end if;
  if length(coalesce(p_description, '')) > 2000 then
    raise exception 'Quiz description must be 2000 characters or fewer';
  end if;
  if jsonb_typeof(p_questions) is distinct from 'array' then
    raise exception 'Add between 1 and 100 structured questions';
  end if;
  if jsonb_array_length(p_questions) < 1 or jsonb_array_length(p_questions) > 100 then
    raise exception 'Add between 1 and 100 structured questions';
  end if;
  if p_paper_id is not null and not exists (
    select 1 from public.papers paper
    where paper.id = p_paper_id and paper.status = 'approved'
  ) then
    raise exception 'The selected past paper is not available';
  end if;
  if p_source_file_path is not null
     and p_source_file_path not like auth.uid()::text || '/quiz-sources/%' then
    raise exception 'Invalid quiz source document path';
  end if;

  if p_quiz_id is null then
    insert into public.quiz_sets (
      title, description, paper_id, source_file_path, source_file_name, created_by
    )
    values (
      trim(p_title), coalesce(trim(p_description), ''), p_paper_id,
      p_source_file_path, nullif(trim(p_source_file_name), ''), auth.uid()
    )
    returning id into saved_quiz_id;
  else
    update public.quiz_sets quiz
    set title = trim(p_title),
        description = coalesce(trim(p_description), ''),
        paper_id = p_paper_id,
        source_file_path = coalesce(p_source_file_path, quiz.source_file_path),
        source_file_name = coalesce(nullif(trim(p_source_file_name), ''), quiz.source_file_name),
        updated_at = now()
    where quiz.id = p_quiz_id
      and (
        (quiz.created_by = auth.uid() and quiz.status in ('draft', 'needs_revision'))
        or (
          quiz.created_by <> auth.uid()
          and quiz.status = 'pending_review'
          and public.has_admin_permission('quiz.review')
        )
      )
      and (
        quiz.paper_id is not distinct from p_paper_id
        or (quiz.paper_id is null and p_paper_id is not null)
      )
    returning quiz.id into saved_quiz_id;
    if saved_quiz_id is null then
      raise exception 'This quiz is not available for editing';
    end if;
    reviewer_edit := exists (
      select 1 from public.quiz_sets quiz
      where quiz.id = saved_quiz_id
        and quiz.status = 'pending_review'
        and quiz.created_by <> auth.uid()
    );
    delete from public.quiz_set_questions where quiz_id = saved_quiz_id;
  end if;

  for question_data in select value from jsonb_array_elements(p_questions)
  loop
    question_position := question_position + 1;
    prompt_text := nullif(trim(question_data->>'prompt'), '');
    option_values := question_data->'options';
    if prompt_text is null or length(prompt_text) > 2000 then
      raise exception 'Question % needs a prompt and answer options', question_position;
    end if;
    if jsonb_typeof(option_values) is distinct from 'array' then
      raise exception 'Question % needs a prompt and answer options', question_position;
    end if;
    option_count := jsonb_array_length(option_values);
    if option_count < 2 or option_count > 6 then
      raise exception 'Question % must have between 2 and 6 options', question_position;
    end if;
    if exists (
      select 1 from jsonb_array_elements(option_values) option_value
      where jsonb_typeof(option_value) <> 'string'
        or nullif(trim(option_value #>> '{}'), '') is null
        or length(option_value #>> '{}') > 500
    ) then
      raise exception 'Question % has an empty or overly long answer option', question_position;
    end if;
    if coalesce(question_data->>'correct_index', '') !~ '^[0-5]$' then
      if question_data->>'correct_index' is not null
         and question_data->>'correct_index' <> '' then
        raise exception 'Choose a valid correct answer for question %', question_position;
      end if;
      correct_answer := null;
    else
      correct_answer := (question_data->>'correct_index')::integer;
    end if;
    if correct_answer is not null and correct_answer >= option_count then
      raise exception 'The correct answer for question % is not one of its options', question_position;
    end if;
    explanation_text := nullif(trim(question_data->>'explanation'), '');
    if length(coalesce(explanation_text, '')) > 2000 then
      raise exception 'Question % explanation must be 2000 characters or fewer', question_position;
    end if;
    question_review_status := 'pending';
    if reviewer_edit then
      question_review_status := coalesce(question_data->>'review_status', 'pending');
      if question_review_status not in ('pending', 'approved', 'rejected') then
        raise exception 'Choose a valid review status for question %', question_position;
      end if;
      if question_review_status = 'approved' and correct_answer is null then
        raise exception 'Choose a correct answer before approving question %', question_position;
      end if;
    end if;
    insert into public.quiz_set_questions (
      quiz_id, paper_id, position, prompt, options, correct_index, explanation,
      review_status, source_page, source_note
    )
    values (
      saved_quiz_id,
      p_paper_id,
      question_position,
      prompt_text,
      option_values,
      correct_answer,
      explanation_text,
      question_review_status,
      case when p_paper_id is not null
             and coalesce(question_data->>'source_page', '') ~ '^[1-9][0-9]*$'
        then (question_data->>'source_page')::integer else null end,
      nullif(trim(question_data->>'source_note'), '')
    );
  end loop;

  update public.quiz_sets set updated_at = now() where id = saved_quiz_id;
  return saved_quiz_id;
end;
$$;

create or replace function public.admin_request_quiz_review(p_quiz_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.has_admin_permission('quiz.manage') then
    raise exception 'Quiz management permission is required' using errcode = '42501';
  end if;
  update public.quiz_sets quiz
  set status = 'pending_review', updated_at = now()
  where quiz.id = p_quiz_id
    and quiz.created_by = auth.uid()
    and quiz.status in ('draft', 'needs_revision')
    and exists (
      select 1 from public.quiz_set_questions question
      where question.quiz_id = quiz.id
        and question.paper_id is not distinct from quiz.paper_id
    );
  if not found then
    raise exception 'Save a quiz draft with questions before requesting review';
  end if;
end;
$$;

create or replace function public.admin_review_quiz_set(p_quiz_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.has_admin_permission('quiz.review') then
    raise exception 'Quiz review permission is required' using errcode = '42501';
  end if;
  if p_decision not in ('publish', 'needs_revision') then
    raise exception 'Choose publish or return for revision';
  end if;
  if p_decision = 'publish' and not exists (
    select 1
    from public.quiz_set_questions question
    join public.quiz_sets quiz on quiz.id = question.quiz_id
    where quiz.id = p_quiz_id
      and quiz.status = 'pending_review'
      and quiz.created_by <> auth.uid()
      and question.paper_id is not distinct from quiz.paper_id
      and question.review_status = 'approved'
      and question.correct_index is not null
  ) then
    raise exception 'Approve at least one complete question before publishing';
  end if;
  update public.quiz_sets quiz
  set status = case when p_decision = 'publish' then 'published' else 'needs_revision' end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where quiz.id = p_quiz_id
    and quiz.status = 'pending_review'
    and quiz.created_by <> auth.uid()
    and exists (
      select 1 from public.quiz_set_questions question
      where question.quiz_id = quiz.id
        and question.paper_id is not distinct from quiz.paper_id
    );
  if not found then
    raise exception 'A different authorized reviewer must review a submitted quiz with questions';
  end if;
  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(),
    case when p_decision = 'publish' then 'quiz.published' else 'quiz.returned' end,
    'quiz',
    p_quiz_id::text,
    jsonb_build_object('decision', p_decision)
  );
end;
$$;

create or replace function public.get_published_quiz_sets()
returns table (
  id uuid,
  title text,
  description text,
  paper_id uuid,
  course_code text,
  course_title text,
  university text,
  source_file_path text,
  source_file_name text,
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
      course.code, course.title, course.university,
      coalesce(quiz.source_file_path, paper.file_path),
      coalesce(nullif(quiz.source_file_name, ''), split_part(paper.file_path, '/', 3)),
      (select count(*) from public.quiz_set_questions question
       where question.quiz_id = quiz.id
         and question.paper_id is not distinct from quiz.paper_id
         and question.review_status = 'approved'
         and question.correct_index is not null),
      quiz.created_at
    from public.quiz_sets quiz
    left join public.papers paper on paper.id = quiz.paper_id
    left join public.courses course on course.id = paper.course_id
    where quiz.status = 'published'
      and exists (
        select 1 from public.quiz_set_questions question
        where question.quiz_id = quiz.id
          and question.paper_id is not distinct from quiz.paper_id
          and question.review_status = 'approved'
          and question.correct_index is not null
      )
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
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.quiz_sets quiz where quiz.id = p_quiz_id and quiz.status = 'published'
  ) then
    raise exception 'This quiz is not published';
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
    order by question.position;
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
    select question.id, question.correct_index
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
    if answer_index >= (
      select jsonb_array_length(question.options)
      from public.quiz_set_questions question where question.id = quiz_question.id
    ) then
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

drop function if exists public.admin_list_quiz_sets_with_audience();
create function public.admin_list_quiz_sets_with_audience()
returns table (
  id uuid,
  title text,
  description text,
  paper_id uuid,
  status text,
  created_by uuid,
  creator_name text,
  question_count bigint,
  created_at timestamptz,
  audience_university text,
  audience_department text,
  audience_level text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not (public.has_admin_permission('quiz.manage') or public.has_admin_permission('quiz.review')) then
    raise exception 'Quiz management permission is required' using errcode = '42501';
  end if;

  return query
    select quiz.id, quiz.title, quiz.description, quiz.paper_id, quiz.status,
      quiz.created_by, coalesce(profile.full_name, 'Administrator'),
      (select count(*) from public.quiz_set_questions question where question.quiz_id = quiz.id),
      quiz.created_at, quiz.audience_university, quiz.audience_department, quiz.audience_level
    from public.quiz_sets quiz
    left join public.profiles profile on profile.id = quiz.created_by
    order by quiz.created_at desc
    limit 200;
end;
$$;

create or replace function public.admin_get_quiz_draft_with_audience(p_quiz_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  draft_data jsonb;
  audience record;
begin
  draft_data := public.admin_get_quiz_draft(p_quiz_id);

  select quiz.audience_university, quiz.audience_department, quiz.audience_level
  into audience
  from public.quiz_sets quiz
  where quiz.id = p_quiz_id;

  if not found then
    raise exception 'This quiz is not available for editing';
  end if;

  return draft_data || jsonb_build_object(
    'audience_university', audience.audience_university,
    'audience_department', audience.audience_department,
    'audience_level', audience.audience_level
  );
end;
$$;

drop function if exists public.admin_save_quiz_draft_with_audience(uuid, text, text, uuid, jsonb, text, text, text, text, text);
create function public.admin_save_quiz_draft_with_audience(
  p_quiz_id uuid,
  p_title text,
  p_description text,
  p_paper_id uuid,
  p_questions jsonb,
  p_source_file_path text,
  p_source_file_name text,
  p_audience_university text,
  p_audience_department text,
  p_audience_level text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  saved_quiz_id uuid;
  audience_university_value text := nullif(trim(p_audience_university), '');
  audience_department_value text := nullif(trim(p_audience_department), '');
  audience_level_value text := nullif(trim(p_audience_level), '');
begin
  if audience_university_value is not null and not exists (
    select 1
    from public.universities university
    where university.is_active
      and lower(trim(university.name)) = lower(audience_university_value)
  ) then
    raise exception 'Choose an active university from the directory';
  end if;

  if length(coalesce(audience_department_value, '')) > 120 then
    raise exception 'Department must be 120 characters or fewer';
  end if;

  if audience_level_value is not null and audience_level_value not in (
    '100 Level', '200 Level', '300 Level', '400 Level', '500 Level'
  ) then
    raise exception 'Choose a valid year of study';
  end if;

  select public.admin_save_quiz_draft(
    p_quiz_id,
    p_title,
    p_description,
    p_paper_id,
    p_questions,
    p_source_file_path,
    p_source_file_name
  ) into saved_quiz_id;

  update public.quiz_sets
  set audience_university = audience_university_value,
      audience_department = audience_department_value,
      audience_level = audience_level_value,
      updated_at = now()
  where id = saved_quiz_id;

  return saved_quiz_id;
end;
$$;

drop function if exists public.get_published_quiz_sets_for_current_user();
create function public.get_published_quiz_sets_for_current_user()
returns table (
  id uuid,
  title text,
  description text,
  paper_id uuid,
  course_code text,
  course_title text,
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
      course.code, course.title, course.university,
      coalesce(quiz.source_file_path, paper.file_path),
      coalesce(nullif(quiz.source_file_name, ''), split_part(paper.file_path, '/', 3)),
      quiz.audience_university, quiz.audience_department, quiz.audience_level,
      (select count(*) from public.quiz_set_questions question
       where question.quiz_id = quiz.id
         and question.paper_id is not distinct from quiz.paper_id
         and question.review_status = 'approved'
         and question.correct_index is not null),
      quiz.created_at
    from public.quiz_sets quiz
    left join public.papers paper on paper.id = quiz.paper_id
    left join public.courses course on course.id = paper.course_id
    where quiz.status = 'published'
      and exists (
        select 1 from public.quiz_set_questions question
        where question.quiz_id = quiz.id
          and question.paper_id is not distinct from quiz.paper_id
          and question.review_status = 'approved'
          and question.correct_index is not null
      )
    order by quiz.created_at desc;
end;
$$;

create or replace function public.create_battle_challenge(p_quiz_id uuid, p_opponent_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  battle_id uuid;
  shared_questions uuid[];
  player_university text;
  opponent_university text;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if p_opponent_id = auth.uid() then raise exception 'Choose another player'; end if;
  select profile.university into player_university
  from public.profiles profile where profile.id = auth.uid();
  select profile.university into opponent_university
  from public.profiles profile where profile.id = p_opponent_id;
  if nullif(trim(player_university), '') is null
     or lower(player_university) <> lower(coalesce(opponent_university, ''))
     or public.current_user_is_suspended_for(p_opponent_id) then
    raise exception 'Challenges are limited to active students at your university';
  end if;
  if not exists (
    select 1 from public.quiz_sets quiz where quiz.id = p_quiz_id and quiz.status = 'published'
  ) then
    raise exception 'Choose a published quiz';
  end if;
  select array_agg(question.id order by question.position) into shared_questions
  from public.quiz_set_questions question
  where question.quiz_id = p_quiz_id
    and question.paper_id is not distinct from (
      select quiz.paper_id from public.quiz_sets quiz where quiz.id = p_quiz_id
    )
    and question.review_status = 'approved'
    and question.correct_index is not null;
  if coalesce(cardinality(shared_questions), 0) = 0 then
    raise exception 'This quiz has no questions';
  end if;
  if exists (
    select 1 from public.battle_challenges battle
    where battle.status in ('pending', 'active')
      and ((battle.challenger_id = auth.uid() and battle.challenged_id = p_opponent_id)
        or (battle.challenger_id = p_opponent_id and battle.challenged_id = auth.uid()))
  ) then
    raise exception 'There is already an open challenge between these players';
  end if;

  insert into public.battle_challenges (quiz_id, challenger_id, challenged_id, question_ids)
  values (p_quiz_id, auth.uid(), p_opponent_id, shared_questions)
  returning id into battle_id;
  return battle_id;
end;
$$;

create or replace function public.get_battle_questions(p_battle_id uuid)
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
security definer
set search_path = pg_catalog, public
as $$
declare
  target_quiz_id uuid;
  target_questions uuid[];
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  select battle.quiz_id, battle.question_ids into target_quiz_id, target_questions
  from public.battle_challenges battle
  where battle.id = p_battle_id
    and auth.uid() in (battle.challenger_id, battle.challenged_id)
    and battle.status in ('active', 'completed');
  if target_quiz_id is null then
    raise exception 'This battle is not available to your account';
  end if;
  insert into public.battle_starts (battle_id, user_id)
  values (p_battle_id, auth.uid())
  on conflict (battle_id, user_id) do nothing;
  return query
    select question.id, question.quiz_id, question.paper_id,
      question.position, question.prompt, question.options, question.explanation
    from public.quiz_set_questions question
    where question.id = any(target_questions)
      and question.paper_id is not distinct from (
        select quiz.paper_id from public.quiz_sets quiz where quiz.id = target_quiz_id
      )
      and question.review_status = 'approved'
      and question.correct_index is not null
    order by array_position(target_questions, question.id);
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
  winner_streak integer;
  points_earned integer := 0;
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
    points_earned := case
      when calculated_winner is null then 1
      when calculated_winner = auth.uid() then 4
      else 1
    end;

    foreach player_id in array array[battle.challenger_id, battle.challenged_id]
    loop
      insert into public.player_game_stats (
        user_id, points, battles_played, battle_wins, battle_losses,
        current_win_streak, best_win_streak
      )
      values (
        player_id,
        case when calculated_winner is null then 1 when player_id = calculated_winner then 4 else 1 end,
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
            else 0 end,
          best_win_streak = greatest(
            public.player_game_stats.best_win_streak,
            case when player_id = calculated_winner
              then public.player_game_stats.current_win_streak + 1 else 0 end
          ),
          updated_at = now();
    end loop;
  end if;

  select current_win_streak into winner_streak
  from public.player_game_stats where user_id = auth.uid();
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

revoke all on function public.admin_list_quiz_sets_with_audience() from public, anon;
revoke all on function public.admin_get_quiz_draft_with_audience(uuid) from public, anon;
revoke all on function public.admin_save_quiz_draft_with_audience(uuid, text, text, uuid, jsonb, text, text, text, text, text) from public, anon;
revoke all on function public.get_published_quiz_sets_for_current_user() from public, anon;

grant execute on function public.admin_list_quiz_sets_with_audience() to authenticated;
grant execute on function public.admin_get_quiz_draft_with_audience(uuid) to authenticated;
grant execute on function public.admin_save_quiz_draft_with_audience(uuid, text, text, uuid, jsonb, text, text, text, text, text) to authenticated;
grant execute on function public.get_published_quiz_sets_for_current_user() to authenticated;

notify pgrst, 'reload schema';

commit;
