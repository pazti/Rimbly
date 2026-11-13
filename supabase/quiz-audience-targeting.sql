-- Run after quiz-battles.sql in the Supabase SQL Editor.
-- Blank targeting fields leave a published quiz available to all active students.

begin;

alter table public.quiz_sets
  add column if not exists target_university text,
  add column if not exists target_department text,
  add column if not exists target_level text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quiz_sets_target_university_length_check'
      and conrelid = 'public.quiz_sets'::regclass
  ) then
    alter table public.quiz_sets
      add constraint quiz_sets_target_university_length_check
      check (target_university is null or length(target_university) between 1 and 200);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'quiz_sets_target_department_length_check'
      and conrelid = 'public.quiz_sets'::regclass
  ) then
    alter table public.quiz_sets
      add constraint quiz_sets_target_department_length_check
      check (target_department is null or length(target_department) between 1 and 120);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'quiz_sets_target_level_check'
      and conrelid = 'public.quiz_sets'::regclass
  ) then
    alter table public.quiz_sets
      add constraint quiz_sets_target_level_check
      check (target_level is null or target_level in (
        '100 Level', '200 Level', '300 Level', '400 Level', '500 Level'
      ));
  end if;
end;
$$;

create index if not exists quiz_sets_published_audience_idx
  on public.quiz_sets (target_university, target_department, target_level)
  where status = 'published';

create or replace function public.admin_list_quiz_sets_with_audience()
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
  target_university text,
  target_department text,
  target_level text
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
      quiz.created_at, quiz.target_university, quiz.target_department, quiz.target_level
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

  select quiz.target_university, quiz.target_department, quiz.target_level
  into audience
  from public.quiz_sets quiz
  where quiz.id = p_quiz_id;

  if not found then
    raise exception 'This quiz is not available for editing';
  end if;

  return draft_data || jsonb_build_object(
    'target_university', audience.target_university,
    'target_department', audience.target_department,
    'target_level', audience.target_level
  );
end;
$$;

create or replace function public.admin_save_quiz_draft_with_audience(
  p_quiz_id uuid,
  p_title text,
  p_description text,
  p_paper_id uuid,
  p_questions jsonb,
  p_source_file_path text,
  p_source_file_name text,
  p_target_university text,
  p_target_department text,
  p_target_level text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  saved_quiz_id uuid;
  target_university_value text := nullif(trim(p_target_university), '');
  target_department_value text := nullif(trim(p_target_department), '');
  target_level_value text := nullif(trim(p_target_level), '');
begin
  if target_university_value is not null and not exists (
    select 1
    from public.universities university
    where university.is_active
      and lower(trim(university.name)) = lower(target_university_value)
  ) then
    raise exception 'Choose an active university from the directory';
  end if;

  if length(coalesce(target_department_value, '')) > 120 then
    raise exception 'Department must be 120 characters or fewer';
  end if;

  if target_level_value is not null and target_level_value not in (
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
  set target_university = target_university_value,
      target_department = target_department_value,
      target_level = target_level_value,
      updated_at = now()
  where id = saved_quiz_id;

  return saved_quiz_id;
end;
$$;

create or replace function public.get_published_quiz_sets_for_current_user()
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
  target_university text,
  target_department text,
  target_level text,
  question_count bigint,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  student_profile public.profiles%rowtype;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  select * into student_profile
  from public.profiles profile
  where profile.id = auth.uid();

  return query
    select quiz.id, quiz.title, quiz.description, quiz.paper_id,
      course.code, course.title, course.university,
      paper.file_path,
      split_part(paper.file_path, '/', 3),
      quiz.target_university, quiz.target_department, quiz.target_level,
      (select count(*) from public.quiz_set_questions question
       where question.quiz_id = quiz.id
         and question.paper_id = quiz.paper_id
         and question.review_status = 'approved'
         and question.correct_index is not null),
      quiz.created_at
    from public.quiz_sets quiz
    left join public.papers paper on paper.id = quiz.paper_id
    left join public.courses course on course.id = paper.course_id
    where quiz.status = 'published'
      and (quiz.target_university is null or
        lower(trim(quiz.target_university)) = lower(trim(coalesce(student_profile.university, ''))))
      and (quiz.target_department is null or
        lower(trim(quiz.target_department)) = lower(trim(coalesce(student_profile.department, ''))))
      and (quiz.target_level is null or
        lower(trim(quiz.target_level)) = lower(trim(coalesce(student_profile.level, ''))))
      and exists (
        select 1 from public.quiz_set_questions question
        where question.quiz_id = quiz.id
          and question.paper_id = quiz.paper_id
          and question.review_status = 'approved'
          and question.correct_index is not null
      )
    order by quiz.created_at desc;
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
