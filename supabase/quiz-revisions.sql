-- Run after quiz-audience-targeting.sql to preserve live quiz versions during edits.
begin;

alter table public.quiz_sets
  add column if not exists replaces_quiz_id uuid references public.quiz_sets(id) on delete restrict;

comment on column public.quiz_sets.replaces_quiz_id is
  'Published quiz revision that this draft replaces after a separate reviewer approves it.';

create index if not exists quiz_sets_replaces_quiz_idx
  on public.quiz_sets (replaces_quiz_id)
  where replaces_quiz_id is not null;

create unique index if not exists quiz_sets_one_open_revision_idx
  on public.quiz_sets (replaces_quiz_id)
  where replaces_quiz_id is not null
    and status in ('draft', 'needs_revision', 'pending_review');

drop function if exists public.get_published_quiz_sets_for_current_user();
create function public.get_published_quiz_sets_for_current_user()
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
  audience_level text,
  replaces_quiz_id uuid
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
      quiz.created_at, quiz.audience_university, quiz.audience_department,
      quiz.audience_level, quiz.replaces_quiz_id
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
  quiz_metadata record;
begin
  draft_data := public.admin_get_quiz_draft(p_quiz_id);

  select quiz.audience_university, quiz.audience_department, quiz.audience_level,
    quiz.replaces_quiz_id
  into quiz_metadata
  from public.quiz_sets quiz
  where quiz.id = p_quiz_id;

  if not found then
    raise exception 'This quiz is not available for editing';
  end if;

  return draft_data || jsonb_build_object(
    'audience_university', quiz_metadata.audience_university,
    'audience_department', quiz_metadata.audience_department,
    'audience_level', quiz_metadata.audience_level,
    'replaces_quiz_id', quiz_metadata.replaces_quiz_id
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
begin
  if auth.uid() is null
     or public.current_user_is_suspended()
     or not public.has_admin_permission('quiz.manage') then
    raise exception 'Quiz management permission is required' using errcode = '42501';
  end if;

  select * into source_quiz
  from public.quiz_sets quiz
  where quiz.id = p_quiz_id
    and quiz.status = 'published'
    and quiz.created_by = auth.uid()
  for update;
  if not found then
    raise exception 'Only the creator can revise a published quiz';
  end if;

  select revision.id, revision.status into revision_id, revision_status
  from public.quiz_sets revision
  where revision.replaces_quiz_id = source_quiz.id
    and revision.created_by = auth.uid()
    and revision.status in ('draft', 'needs_revision', 'pending_review')
  limit 1;
  if revision_status = 'pending_review' then
    raise exception 'A revision is already in review; wait for the reviewer before editing again';
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
  select revision_id, question.paper_id, question.position, question.prompt,
    question.options, question.correct_index, question.explanation, 'approved',
    question.source_page, question.source_note
  from public.quiz_set_questions question
  where question.quiz_id = source_quiz.id
    and question.paper_id is not distinct from source_quiz.paper_id
    and question.review_status = 'approved'
    and question.correct_index is not null
  order by question.position;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(), 'quiz.revision_started', 'quiz', revision_id::text,
    jsonb_build_object('replaces_quiz_id', source_quiz.id)
  );

  return revision_id;
end;
$$;

create or replace function public.admin_review_quiz_set(p_quiz_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  replaced_quiz_id uuid;
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

  select quiz.replaces_quiz_id into replaced_quiz_id
  from public.quiz_sets quiz
  where quiz.id = p_quiz_id
    and quiz.status = 'pending_review'
    and quiz.created_by <> auth.uid();

  if p_decision = 'publish'
     and replaced_quiz_id is not null
     and not exists (
       select 1 from public.quiz_sets original
       where original.id = replaced_quiz_id and original.status = 'published'
     ) then
    raise exception 'The original quiz is no longer published; refresh the review queue';
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

  if p_decision = 'publish' and replaced_quiz_id is not null then
    update public.quiz_sets
    set status = 'archived', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where id = replaced_quiz_id and status = 'published';
    if not found then
      raise exception 'The original quiz could not be archived; the revision was not published';
    end if;
  end if;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(),
    case when p_decision = 'publish' then 'quiz.published' else 'quiz.returned' end,
    'quiz',
    p_quiz_id::text,
    jsonb_build_object('decision', p_decision, 'replaces_quiz_id', replaced_quiz_id)
  );
end;
$$;

revoke all on function public.get_published_quiz_sets_for_current_user() from public, anon;
revoke all on function public.admin_list_quiz_sets_with_audience() from public, anon;
revoke all on function public.admin_get_quiz_draft_with_audience(uuid) from public, anon;
revoke all on function public.admin_create_quiz_revision(uuid) from public, anon;

grant execute on function public.get_published_quiz_sets_for_current_user() to authenticated;
grant execute on function public.admin_list_quiz_sets_with_audience() to authenticated;
grant execute on function public.admin_get_quiz_draft_with_audience(uuid) to authenticated;
grant execute on function public.admin_create_quiz_revision(uuid) to authenticated;

commit;
