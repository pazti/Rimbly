-- Run after quiz-battles.sql, quiz-revisions.sql, and maintenance-mode.sql.
-- Expose bounded catalog metadata to anonymous visitors, never source files or answer keys.
begin;

create or replace function public.get_guest_explore_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  catalog jsonb;
begin
  if not public.maintenance_app_access_allowed() then
    raise exception 'Guest Explore is unavailable during maintenance';
  end if;

  select jsonb_build_object(
    'courses',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', course.id,
          'code', course.code,
          'title', course.title,
          'university', course.university,
          'faculty', course.faculty,
          'department', course.department,
          'level', course.level,
          'is_verified', course.is_verified,
          'paper_count', course.paper_count,
          'has_reviewed_quiz', course.has_reviewed_quiz
        )
        order by lower(course.university), upper(course.code)
      )
      from (
        select course.id, course.code, course.title, course.university,
          course.faculty, course.department, course.level, course.is_verified,
          count(paper.id)::integer as paper_count,
          exists (
            select 1
            from public.papers quiz_paper
            join public.quiz_sets quiz on quiz.paper_id = quiz_paper.id
            join public.quiz_set_questions question
              on question.quiz_id = quiz.id
             and question.paper_id = quiz.paper_id
            where quiz_paper.course_id = course.id
              and quiz_paper.status = 'approved'
              and quiz.status = 'published'
              and question.review_status = 'approved'
              and question.correct_index is not null
          ) as has_reviewed_quiz
        from public.courses course
        left join public.papers paper
          on paper.course_id = course.id
         and paper.status = 'approved'
        group by course.id
        order by lower(course.university), upper(course.code)
        limit 250
      ) course
    ), '[]'::jsonb),
    'quizzes',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', quiz.id,
          'title', quiz.title,
          'description', quiz.description,
          'course_code', quiz.course_code,
          'course_title', quiz.course_title,
          'university', quiz.university,
          'question_count', quiz.question_count
        )
        order by quiz.created_at desc
      )
      from (
        select quiz.id, quiz.title, quiz.description, course.code as course_code,
          course.title as course_title, course.university,
          count(question.id)::integer as question_count, quiz.created_at
        from public.quiz_sets quiz
        join public.papers paper
          on paper.id = quiz.paper_id
         and paper.status = 'approved'
        join public.courses course on course.id = paper.course_id
        join public.quiz_set_questions question
          on question.quiz_id = quiz.id
         and question.paper_id = quiz.paper_id
         and question.review_status = 'approved'
         and question.correct_index is not null
        where quiz.status = 'published'
        group by quiz.id, course.code, course.title, course.university
        order by quiz.created_at desc
        limit 100
      ) quiz
    ), '[]'::jsonb)
  ) into catalog;

  return catalog;
end;
$$;

revoke all on function public.get_guest_explore_catalog() from public, anon, authenticated;
grant execute on function public.get_guest_explore_catalog() to anon;

comment on function public.get_guest_explore_catalog() is
  'Returns bounded public course and reviewed-quiz metadata without source file paths, question contents, or answer keys.';

notify pgrst, 'reload schema';
commit;
