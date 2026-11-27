-- Apply after harden-submission-workflows.sql. Keep the student quiz RPC
-- limited to the ten questions requested by the quiz UI.
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
    order by hashtextextended(
      question.id::text || (now() at time zone 'UTC')::date::text,
      0
    )
    limit 10;
end;
$$;

revoke all on function public.get_quiz_set_questions(uuid) from public, anon;
grant execute on function public.get_quiz_set_questions(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
