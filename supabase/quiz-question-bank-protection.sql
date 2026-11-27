-- Apply after harden-submission-workflows.sql. Keep both student quiz RPCs
-- limited to the ten questions requested and answered in the attempt.
begin;

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
volatile
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
    select 1
    from public.quiz_sets quiz
    where quiz.id = p_quiz_id and quiz.status = 'published'
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

  if approved_question_count < 10 then
    raise exception 'This quiz needs at least 10 approved questions';
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
    order by random()
    limit 10;
end;
$$;

revoke all on function public.get_quiz_set_questions(uuid) from public, anon;
grant execute on function public.get_quiz_set_questions(uuid) to authenticated;

create or replace function public.get_quiz_attempt_review(p_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_quiz_id uuid;
  v_saved_answers jsonb;
  review_items jsonb;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  select attempt.quiz_id, attempt.answers
  into v_quiz_id, v_saved_answers
  from public.quiz_set_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.user_id = auth.uid();
  if not found then
    raise exception 'Quiz attempt was not found' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', question.id,
        'position', question.position,
        'prompt', question.prompt,
        'options', question.options,
        'correct_index', question.correct_index,
        'selected_index', (v_saved_answers->>question.id::text)::integer,
        'explanation', coalesce(question.explanation, '')
      )
      order by question.position
    ),
    '[]'::jsonb
  )
  into review_items
  from (
    select source_question.id, source_question.position, source_question.prompt,
      source_question.options, source_question.correct_index, source_question.explanation
    from public.quiz_set_questions source_question
    where source_question.quiz_id = v_quiz_id
      and source_question.paper_id is not distinct from (
        select quiz.paper_id from public.quiz_sets quiz where quiz.id = v_quiz_id
      )
      and source_question.review_status = 'approved'
      and source_question.correct_index is not null
      and v_saved_answers ? source_question.id::text
    order by source_question.position
    limit 10
  ) question;

  return review_items;
end;
$$;

revoke all on function public.get_quiz_attempt_review(uuid) from public, anon;
grant execute on function public.get_quiz_attempt_review(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
