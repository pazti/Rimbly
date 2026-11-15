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
  from public.quiz_set_questions question
  where question.quiz_id = v_quiz_id
    and question.paper_id is not distinct from (
      select quiz.paper_id from public.quiz_sets quiz where quiz.id = v_quiz_id
    )
    and question.review_status = 'approved'
    and question.correct_index is not null;

  return review_items;
end;
$$;

revoke all on function public.get_quiz_attempt_review(uuid) from public, anon;
grant execute on function public.get_quiz_attempt_review(uuid) to authenticated;
