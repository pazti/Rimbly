-- Run after admin-management.sql, quiz-audience-targeting.sql, and quiz-revisions.sql.
-- Adds audited Super Admin editing for past papers and cross-creator quiz management.
begin;

create or replace function public.admin_list_editable_papers()
returns table (
  id uuid,
  course_id uuid,
  university text,
  course_code text,
  course_title text,
  course_faculty text,
  course_department text,
  course_level text,
  course_semester text,
  course_is_verified boolean,
  academic_session text,
  semester text,
  exam_year integer,
  file_path text,
  paper_is_verified boolean,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.has_admin_permission('papers.manage') then
    raise exception 'Past paper management permission is required' using errcode = '42501';
  end if;

  return query
    select paper.id, course.id, course.university, course.code, course.title,
      course.faculty, course.department, course.level, course.semester, course.is_verified,
      paper.academic_session, paper.semester, paper.exam_year, paper.file_path,
      paper.is_verified, paper.status::text, paper.created_at
    from public.papers paper
    join public.courses course on course.id = paper.course_id
    order by paper.created_at desc
    limit 500;
end;
$$;

create or replace function public.admin_update_paper(
  p_paper_id uuid,
  p_university text,
  p_course_code text,
  p_course_title text,
  p_faculty text,
  p_department text,
  p_level text,
  p_course_semester text,
  p_course_verified boolean,
  p_academic_session text,
  p_semester text,
  p_exam_year integer,
  p_paper_verified boolean,
  p_replacement_file_path text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_paper public.papers%rowtype;
  target_course public.courses%rowtype;
  previous_values jsonb;
  next_values jsonb;
begin
  if auth.uid() is null
     or public.current_user_is_suspended()
     or not exists (
       select 1 from public.admin_memberships membership
       where membership.user_id = auth.uid()
         and membership.role_id = 'super_admin'
         and membership.status = 'active'
     ) then
    raise exception 'Super Admin access is required to edit published papers' using errcode = '42501';
  end if;
  if nullif(trim(p_university), '') is null
     or nullif(trim(p_course_code), '') is null
     or nullif(trim(p_course_title), '') is null
     or nullif(trim(p_academic_session), '') is null then
    raise exception 'University, course code, course title, and academic session are required';
  end if;
  if length(trim(p_course_code)) > 40
     or length(trim(p_course_title)) > 200
     or length(trim(p_academic_session)) > 40
     or length(coalesce(p_faculty, '')) > 120
     or length(coalesce(p_department, '')) > 120 then
    raise exception 'One or more paper details exceed the allowed length';
  end if;
  if p_exam_year is null or p_exam_year < 1990
     or p_exam_year > extract(year from now())::integer + 1 then
    raise exception 'Exam year is outside the allowed range';
  end if;
  if p_level is not null and p_level not in (
    '100 Level', '200 Level', '300 Level', '400 Level', '500 Level', 'Postgraduate'
  ) then
    raise exception 'Choose a valid course level';
  end if;
  if p_semester is not null and p_semester not in ('First Semester', 'Second Semester') then
    raise exception 'Choose a valid paper semester';
  end if;
  if p_course_semester is not null
     and p_course_semester not in ('First Semester', 'Second Semester') then
    raise exception 'Choose a valid course semester';
  end if;
  if p_replacement_file_path is not null
     and (
       p_replacement_file_path not like (auth.uid()::text || '/admin/%')
       or not exists (
         select 1
         from storage.objects object
         where object.bucket_id = 'contributions'
           and object.name = p_replacement_file_path
           and object.owner_id = auth.uid()::text
       )
     ) then
    raise exception 'Invalid replacement paper file';
  end if;

  select * into target_paper
  from public.papers paper
  where paper.id = p_paper_id
  for update;
  if not found then
    raise exception 'Past paper not found';
  end if;

  select * into target_course
  from public.courses course
  where course.id = target_paper.course_id
  for update;
  if not found then
    raise exception 'The paper course could not be found';
  end if;

  previous_values := jsonb_build_object(
    'course_id', target_course.id,
    'university', target_course.university,
    'course_code', target_course.code,
    'course_title', target_course.title,
    'faculty', target_course.faculty,
    'department', target_course.department,
    'level', target_course.level,
    'course_semester', target_course.semester,
    'course_is_verified', target_course.is_verified,
    'academic_session', target_paper.academic_session,
    'paper_semester', target_paper.semester,
    'exam_year', target_paper.exam_year,
    'paper_is_verified', target_paper.is_verified,
    'file_path', target_paper.file_path
  );

  update public.courses
  set university = trim(p_university),
      code = upper(trim(p_course_code)),
      title = trim(p_course_title),
      faculty = nullif(trim(p_faculty), ''),
      department = nullif(trim(p_department), ''),
      level = nullif(trim(p_level), ''),
      semester = nullif(trim(p_course_semester), ''),
      is_verified = p_course_verified
  where id = target_course.id;

  update public.papers
  set academic_session = trim(p_academic_session),
      semester = nullif(trim(p_semester), ''),
      exam_year = p_exam_year,
      is_verified = p_paper_verified,
      file_path = coalesce(p_replacement_file_path, file_path)
  where id = target_paper.id;

  next_values := jsonb_build_object(
    'course_id', target_course.id,
    'university', trim(p_university),
    'course_code', upper(trim(p_course_code)),
    'course_title', trim(p_course_title),
    'faculty', nullif(trim(p_faculty), ''),
    'department', nullif(trim(p_department), ''),
    'level', nullif(trim(p_level), ''),
    'course_semester', nullif(trim(p_course_semester), ''),
    'course_is_verified', p_course_verified,
    'academic_session', trim(p_academic_session),
    'paper_semester', nullif(trim(p_semester), ''),
    'exam_year', p_exam_year,
    'paper_is_verified', p_paper_verified,
    'file_path', coalesce(p_replacement_file_path, target_paper.file_path)
  );

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(),
    'paper.updated',
    'paper',
    target_paper.id::text,
    jsonb_build_object(
      'before', previous_values,
      'after', next_values,
      'course_metadata_affects_all_linked_papers', true
    )
  );
end;
$$;

create or replace function public.admin_create_quiz_revision(p_quiz_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  source_quiz public.quiz_sets%rowtype;
  revision_id uuid;
  revision_status text;
  is_super_admin boolean;
begin
  if auth.uid() is null
     or public.current_user_is_suspended()
     or not public.has_admin_permission('quiz.manage') then
    raise exception 'Quiz management permission is required' using errcode = '42501';
  end if;
  select exists (
    select 1 from public.admin_memberships membership
    where membership.user_id = auth.uid()
      and membership.role_id = 'super_admin'
      and membership.status = 'active'
  ) into is_super_admin;

  select * into source_quiz
  from public.quiz_sets quiz
  where quiz.id = p_quiz_id
    and quiz.status = 'published'
    and (quiz.created_by = auth.uid() or is_super_admin)
  for update;
  if not found then
    raise exception 'Only the creator or a Super Admin can revise a published quiz';
  end if;

  select revision.id, revision.status into revision_id, revision_status
  from public.quiz_sets revision
  where revision.replaces_quiz_id = source_quiz.id
    and revision.status in ('draft', 'needs_revision', 'pending_review')
  limit 1;
  if revision_status = 'pending_review' then
    raise exception 'A revision is already in review; wait for its reviewer';
  end if;
  if revision_id is not null then
    return revision_id;
  end if;

  insert into public.quiz_sets (
    title, description, paper_id, source_file_path, source_file_name, created_by,
    status, audience_university, audience_department, audience_level, replaces_quiz_id
  )
  values (
    source_quiz.title, source_quiz.description, source_quiz.paper_id,
    source_quiz.source_file_path, source_quiz.source_file_name, auth.uid(),
    'draft', source_quiz.audience_university, source_quiz.audience_department,
    source_quiz.audience_level, source_quiz.id
  )
  returning id into revision_id;

  insert into public.quiz_set_questions (
    quiz_id, paper_id, position, prompt, options, correct_index, explanation,
    review_status, source_page, source_note
  )
  select revision_id, source_quiz.paper_id, question.position, question.prompt,
    question.options, question.correct_index, question.explanation, 'pending',
    question.source_page, question.source_note
  from public.quiz_set_questions question
  where question.quiz_id = source_quiz.id
  order by question.position;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(), 'quiz.revision_started', 'quiz', revision_id::text,
    jsonb_build_object(
      'replaces_quiz_id', source_quiz.id,
      'original_creator_id', source_quiz.created_by,
      'started_by_super_admin', is_super_admin
    )
  );

  return revision_id;
end;
$$;

create or replace function public.admin_take_over_quiz_draft(p_quiz_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  prior_creator uuid;
begin
  if auth.uid() is null
     or public.current_user_is_suspended()
     or not exists (
       select 1 from public.admin_memberships membership
       where membership.user_id = auth.uid()
         and membership.role_id = 'super_admin'
         and membership.status = 'active'
     ) then
    raise exception 'Super Admin access is required to edit another creator’s quiz draft'
      using errcode = '42501';
  end if;

  select quiz.created_by into prior_creator
  from public.quiz_sets quiz
  where quiz.id = p_quiz_id
    and quiz.status in ('draft', 'needs_revision')
  for update;
  if not found then
    raise exception 'Only an editable quiz draft can be taken over';
  end if;

  if prior_creator = auth.uid() then
    return;
  end if;

  update public.quiz_sets
  set created_by = auth.uid(), updated_at = now()
  where id = p_quiz_id;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(), 'quiz.draft_taken_over', 'quiz', p_quiz_id::text,
    jsonb_build_object('previous_creator_id', prior_creator)
  );
end;
$$;

create or replace function public.admin_archive_quiz_set(p_quiz_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_quiz public.quiz_sets%rowtype;
  is_super_admin boolean;
begin
  if auth.uid() is null
     or public.current_user_is_suspended()
     or not public.has_admin_permission('quiz.manage') then
    raise exception 'Quiz management permission is required' using errcode = '42501';
  end if;
  select exists (
    select 1 from public.admin_memberships membership
    where membership.user_id = auth.uid()
      and membership.role_id = 'super_admin'
      and membership.status = 'active'
  ) into is_super_admin;

  select * into target_quiz
  from public.quiz_sets quiz
  where quiz.id = p_quiz_id
    and quiz.status <> 'archived'
    and (quiz.created_by = auth.uid() or is_super_admin)
  for update;
  if not found then
    raise exception 'Only the creator or a Super Admin can archive this quiz';
  end if;

  with recursive quiz_family(id) as (
    select target_quiz.id
    union all
    select child.id
    from public.quiz_sets child
    join quiz_family parent on child.replaces_quiz_id = parent.id
  )
  update public.quiz_sets quiz
  set status = 'archived', updated_at = now()
  where quiz.id in (select id from quiz_family)
    and quiz.status <> 'archived';

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(), 'quiz.archived', 'quiz', p_quiz_id::text,
    jsonb_build_object('preserved_attempts_and_battles', true, 'archived_by_super_admin', is_super_admin)
  );
end;
$$;

revoke all on function public.admin_list_editable_papers() from public, anon;
revoke all on function public.admin_update_paper(uuid, text, text, text, text, text, text, text, boolean, text, text, integer, boolean, text) from public, anon;
revoke all on function public.admin_create_quiz_revision(uuid) from public, anon;
revoke all on function public.admin_take_over_quiz_draft(uuid) from public, anon;
revoke all on function public.admin_archive_quiz_set(uuid) from public, anon;

grant execute on function public.admin_list_editable_papers() to authenticated;
grant execute on function public.admin_update_paper(uuid, text, text, text, text, text, text, text, boolean, text, text, integer, boolean, text) to authenticated;
grant execute on function public.admin_create_quiz_revision(uuid) to authenticated;
grant execute on function public.admin_take_over_quiz_draft(uuid) to authenticated;
grant execute on function public.admin_archive_quiz_set(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
