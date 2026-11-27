-- Run after admin-foundation.sql, admin-management.sql, and the core Rimbly schema.
-- Source papers are immutable; structured questions require explicit human review.

create unique index if not exists courses_university_code_unique_idx
  on public.courses (lower(trim(university)), upper(trim(code)));

create table if not exists public.quiz_sets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  paper_id uuid references public.papers(id) on delete restrict,
  source_file_path text,
  source_file_name text,
  created_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'needs_revision', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.quiz_set_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quiz_sets(id) on delete cascade,
  paper_id uuid not null references public.papers(id) on delete restrict,
  position integer not null check (position > 0),
  prompt text not null,
  options jsonb not null,
  correct_index integer,
  explanation text,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  source_page integer check (source_page is null or source_page > 0),
  source_note text,
  created_at timestamptz not null default now(),
  unique (quiz_id, position),
  check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  check (correct_index is null or (correct_index >= 0 and correct_index < jsonb_array_length(options))),
  check (explanation is null or length(explanation) <= 2000)
);

alter table public.quiz_set_questions
  add column if not exists paper_id uuid references public.papers(id) on delete restrict,
  add column if not exists explanation text,
  add column if not exists review_status text not null default 'pending';

alter table public.quiz_set_questions
  alter column correct_index drop not null;

update public.quiz_set_questions question
set paper_id = quiz.paper_id,
    review_status = case when quiz.status = 'published' then 'approved' else 'pending' end
from public.quiz_sets quiz
where question.quiz_id = quiz.id
  and question.paper_id is null;

alter table public.quiz_set_questions
  drop constraint if exists quiz_set_questions_review_status_check;
alter table public.quiz_set_questions
  add constraint quiz_set_questions_review_status_check
  check (review_status in ('pending', 'approved', 'rejected'));

create index if not exists quiz_set_questions_approved_idx
  on public.quiz_set_questions (quiz_id, position)
  where review_status = 'approved' and paper_id is not null;
create table if not exists public.quiz_set_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quiz_id uuid not null references public.quiz_sets(id) on delete restrict,
  score_percent integer not null check (score_percent between 0 and 100),
  correct_count integer not null check (correct_count >= 0),
  total_questions integer not null check (total_questions > 0),
  duration_seconds integer not null check (duration_seconds >= 0),
  answers jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.player_game_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  points bigint not null default 0 check (points >= 0),
  quizzes_completed integer not null default 0 check (quizzes_completed >= 0),
  battles_played integer not null default 0 check (battles_played >= 0),
  battle_wins integer not null default 0 check (battle_wins >= 0),
  battle_losses integer not null default 0 check (battle_losses >= 0),
  current_win_streak integer not null default 0 check (current_win_streak >= 0),
  best_win_streak integer not null default 0 check (best_win_streak >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.track_legacy_quiz_points()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.player_game_stats (user_id, points, quizzes_completed)
  values (new.user_id, new.correct_count * 10, 1)
  on conflict (user_id) do update
  set points = public.player_game_stats.points + excluded.points,
      quizzes_completed = public.player_game_stats.quizzes_completed + 1,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists "award points for legacy quiz" on public.quiz_attempts;
create trigger "award points for legacy quiz"
after insert on public.quiz_attempts
for each row execute function public.track_legacy_quiz_points();

create table if not exists public.battle_challenges (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quiz_sets(id) on delete restrict,
  challenger_id uuid not null references auth.users(id) on delete cascade,
  challenged_id uuid not null references auth.users(id) on delete cascade,
  question_ids uuid[] not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'completed', 'declined', 'cancelled')),
  winner_id uuid references auth.users(id) on delete set null,
  is_draw boolean not null default false,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  check (challenger_id <> challenged_id),
  check (cardinality(question_ids) > 0)
);

create table if not exists public.battle_submissions (
  battle_id uuid not null references public.battle_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null,
  correct_count integer not null check (correct_count >= 0),
  total_questions integer not null check (total_questions > 0),
  duration_seconds double precision not null check (duration_seconds >= 0),
  submitted_at timestamptz not null default now(),
  primary key (battle_id, user_id)
);

create table if not exists public.battle_starts (
  battle_id uuid not null references public.battle_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  primary key (battle_id, user_id)
);

create index if not exists quiz_sets_public_idx
  on public.quiz_sets (status, created_at desc);
create index if not exists quiz_sets_paper_idx
  on public.quiz_sets (paper_id) where paper_id is not null;
create index if not exists quiz_set_attempts_user_idx
  on public.quiz_set_attempts (user_id, created_at desc);
create index if not exists battle_challenges_inbox_idx
  on public.battle_challenges (challenged_id, status, created_at desc);
create index if not exists battle_challenges_outbox_idx
  on public.battle_challenges (challenger_id, status, created_at desc);
create unique index if not exists battle_challenges_open_pair_idx
  on public.battle_challenges (
    least(challenger_id, challenged_id),
    greatest(challenger_id, challenged_id)
  )
  where status in ('pending', 'active');

alter table public.quiz_sets enable row level security;
alter table public.quiz_set_questions enable row level security;
alter table public.quiz_set_attempts enable row level security;
alter table public.player_game_stats enable row level security;
alter table public.battle_challenges enable row level security;
alter table public.battle_submissions enable row level security;
alter table public.battle_starts enable row level security;

revoke all on public.quiz_sets, public.quiz_set_questions, public.quiz_set_attempts,
  public.player_game_stats, public.battle_challenges, public.battle_submissions,
  public.battle_starts
  from anon, authenticated;

insert into public.admin_permissions (id, description)
values
  ('quiz.manage', 'Create and edit manual quiz drafts'),
  ('quiz.review', 'Review and publish quiz content')
on conflict (id) do update set description = excluded.description;

insert into public.admin_role_permissions (role_id, permission_id)
values
  ('admin', 'quiz.manage'),
  ('admin', 'quiz.review'),
  ('moderator', 'quiz.review')
on conflict do nothing;

create or replace function public.admin_list_quiz_sets()
returns table (
  id uuid,
  title text,
  description text,
  paper_id uuid,
  status text,
  created_by uuid,
  creator_name text,
  question_count bigint,
  created_at timestamptz
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
      quiz.created_at
    from public.quiz_sets quiz
    left join public.profiles profile on profile.id = quiz.created_by
    order by quiz.created_at desc
    limit 200;
end;
$$;

create or replace function public.admin_list_quiz_papers()
returns table (
  id uuid,
  course_id uuid,
  university text,
  course_code text,
  course_title text,
  academic_session text,
  semester text,
  exam_year integer,
  file_path text,
  status text,
  created_at timestamptz
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
    select paper.id, paper.course_id, course.university, course.code, course.title,
      paper.academic_session, paper.semester, paper.exam_year, paper.file_path,
      paper.status::text, paper.created_at
    from public.papers paper
    join public.courses course on course.id = paper.course_id
    where paper.status = 'approved'
    order by paper.created_at desc
    limit 500;
end;
$$;

create or replace function public.is_published_quiz_source(p_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.quiz_sets quiz
    where quiz.source_file_path = p_path and quiz.status = 'published'
  );
$$;

drop policy if exists "published quiz sources readable" on storage.objects;
create policy "published quiz sources readable"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'contributions'
  and (storage.foldername(name))[2] = 'quiz-sources'
  and public.is_published_quiz_source(name)
);

drop policy if exists "admin contribution file visibility" on storage.objects;
create policy "admin contribution file visibility"
on storage.objects as restrictive for select to authenticated
using (
  bucket_id <> 'contributions'
  or owner_id = auth.uid()::text
  or public.has_admin_permission('contributions.review')
  or public.has_admin_permission('quiz.review')
  or public.is_published_contribution_file(name)
  or public.is_published_quiz_source(name)
);

drop policy if exists "admin and published contribution files" on storage.objects;
create policy "admin and published contribution files"
on storage.objects for select to authenticated
using (
  bucket_id = 'contributions'
  and (
    public.has_admin_permission('contributions.review')
    or public.has_admin_permission('quiz.review')
    or public.is_published_contribution_file(name)
    or public.is_published_quiz_source(name)
  )
);

create or replace function public.admin_get_quiz_draft(p_quiz_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  quiz_record public.quiz_sets%rowtype;
begin
  if not (public.has_admin_permission('quiz.manage') or public.has_admin_permission('quiz.review')) then
    raise exception 'Quiz access permission is required' using errcode = '42501';
  end if;
  select * into quiz_record
  from public.quiz_sets quiz
  where quiz.id = p_quiz_id
    and (
      (quiz.created_by = auth.uid() and quiz.status in ('draft', 'needs_revision'))
      or (
        quiz.created_by <> auth.uid()
        and quiz.status = 'pending_review'
        and public.has_admin_permission('quiz.review')
      )
    );
  if not found then raise exception 'This quiz is not available for editing'; end if;
  return jsonb_build_object(
    'id', quiz_record.id,
    'title', quiz_record.title,
    'description', quiz_record.description,
    'paper_id', quiz_record.paper_id,
    'source_file_path', quiz_record.source_file_path,
    'source_file_name', quiz_record.source_file_name,
    'review_status', quiz_record.status,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'prompt', question.prompt,
        'options', question.options,
        'correct_index', question.correct_index,
        'explanation', coalesce(question.explanation, ''),
        'review_status', question.review_status,
        'source_page', question.source_page,
        'source_note', coalesce(question.source_note, '')
      ) order by question.position)
      from public.quiz_set_questions question
      where question.quiz_id = quiz_record.id
    ), '[]'::jsonb)
  );
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
  if p_paper_id is null then
    raise exception 'Link this quiz to an approved source paper';
  end if;
  if not exists (
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
      and quiz.paper_id is not distinct from p_paper_id
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
      case when coalesce(question_data->>'source_page', '') ~ '^[1-9][0-9]*$'
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
      where question.quiz_id = quiz.id and question.paper_id = quiz.paper_id
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
      and question.paper_id = quiz.paper_id
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
        and question.paper_id = quiz.paper_id
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
      paper.file_path,
      split_part(paper.file_path, '/', 3),
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

drop function if exists public.get_quiz_set_questions(uuid);
create function public.get_quiz_set_questions(p_quiz_id uuid)
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
      and question.paper_id = (
        select quiz.paper_id from public.quiz_sets quiz where quiz.id = p_quiz_id
      )
      and question.paper_id is not null
      and question.review_status = 'approved'
      and question.correct_index is not null
    order by question.position
    limit 10;
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

  question_total := (select count(*)::integer from jsonb_object_keys(p_answers));
  if question_total <> 10 then
    raise exception 'A quiz attempt must contain exactly 10 answers';
  end if;

  if (
    select count(*)
    from jsonb_object_keys(p_answers) answer_key
    join public.quiz_set_questions question on question.id = answer_key::uuid
    where question.quiz_id = p_quiz_id
      and question.paper_id = (
        select quiz.paper_id from public.quiz_sets quiz where quiz.id = p_quiz_id
      )
      and question.paper_id is not null
      and question.review_status = 'approved'
      and question.correct_index is not null
  ) <> question_total then
    raise exception 'Answers must match the approved questions in this quiz';
  end if;
  for quiz_question in
    select question.id, question.correct_index
    from jsonb_object_keys(p_answers) answer_key
    join public.quiz_set_questions question on question.id = answer_key::uuid
    where question.quiz_id = p_quiz_id
      and question.paper_id = (
        select quiz.paper_id from public.quiz_sets quiz where quiz.id = p_quiz_id
      )
      and question.paper_id is not null
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

create or replace function public.get_my_quiz_set_attempts()
returns table (
  id uuid,
  paper_id uuid,
  quiz_id uuid,
  quiz_title text,
  score_percent integer,
  correct_count integer,
  total_questions integer,
  duration_seconds integer,
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
    select attempt.id, quiz.paper_id, quiz.id, quiz.title, attempt.score_percent,
      attempt.correct_count, attempt.total_questions, attempt.duration_seconds, attempt.created_at
    from public.quiz_set_attempts attempt
    join public.quiz_sets quiz on quiz.id = attempt.quiz_id
    where attempt.user_id = auth.uid()
    order by attempt.created_at desc
    limit 200;
end;
$$;

create or replace function public.search_battle_opponents(p_search text default '')
returns table (user_id uuid, full_name text, university text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  player_university text;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  select profile.university into player_university
  from public.profiles profile where profile.id = auth.uid();
  if nullif(trim(player_university), '') is null then
    raise exception 'Complete your university profile before challenging a player';
  end if;
  return query
    select profile.id, profile.full_name, profile.university
    from public.profiles profile
    where profile.id <> auth.uid()
      and lower(profile.university) = lower(player_university)
      and profile.full_name ilike '%' || left(coalesce(trim(p_search), ''), 80) || '%'
      and not public.current_user_is_suspended_for(profile.id)
    order by profile.full_name
    limit 25;
end;
$$;

create or replace function public.current_user_is_suspended_for(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.admin_user_controls control
    where control.user_id = p_user_id and control.suspended
  );
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
  select profile.university into player_university from public.profiles profile where profile.id = auth.uid();
  select profile.university into opponent_university from public.profiles profile where profile.id = p_opponent_id;
  if nullif(trim(player_university), '') is null
     or lower(player_university) <> lower(coalesce(opponent_university, ''))
     or public.current_user_is_suspended_for(p_opponent_id) then
    raise exception 'Challenges are limited to active students at your university';
  end if;
  if not exists (
    select 1 from public.quiz_sets quiz where quiz.id = p_quiz_id and quiz.status = 'published'
  ) then raise exception 'Choose a published quiz'; end if;
  select array_agg(question.id order by question.position) into shared_questions
  from public.quiz_set_questions question
  where question.quiz_id = p_quiz_id
    and question.paper_id = (
      select quiz.paper_id from public.quiz_sets quiz where quiz.id = p_quiz_id
    )
    and question.paper_id is not null
    and question.review_status = 'approved'
    and question.correct_index is not null;
  if coalesce(cardinality(shared_questions), 0) = 0 then raise exception 'This quiz has no questions'; end if;
  if exists (
    select 1 from public.battle_challenges battle
    where battle.status in ('pending', 'active')
      and ((battle.challenger_id = auth.uid() and battle.challenged_id = p_opponent_id)
        or (battle.challenger_id = p_opponent_id and battle.challenged_id = auth.uid()))
  ) then raise exception 'There is already an open challenge between these players'; end if;

  insert into public.battle_challenges (
    quiz_id, challenger_id, challenged_id, question_ids
  ) values (p_quiz_id, auth.uid(), p_opponent_id, shared_questions)
  returning id into battle_id;
  return battle_id;
end;
$$;

create or replace function public.respond_to_battle_challenge(p_battle_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  update public.battle_challenges battle
  set status = case when p_accept then 'active' else 'declined' end,
      accepted_at = case when p_accept then now() else null end
  where battle.id = p_battle_id
    and battle.challenged_id = auth.uid()
    and battle.status = 'pending';
  if not found then raise exception 'This challenge is no longer waiting for your response'; end if;
end;
$$;

create or replace function public.cancel_battle_challenge(p_battle_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.battle_challenges battle
  set status = 'cancelled'
  where battle.id = p_battle_id
    and battle.challenger_id = auth.uid()
    and battle.status = 'pending';
  if not found then raise exception 'Only the challenger can cancel a waiting challenge'; end if;
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
      battle.status, battle.winner_id, battle.is_draw,
      exists (select 1 from public.battle_submissions submission
        where submission.battle_id = battle.id and submission.user_id = auth.uid()),
      exists (select 1 from public.battle_submissions submission
        where submission.battle_id = battle.id
          and submission.user_id <> auth.uid()
          and submission.user_id in (battle.challenger_id, battle.challenged_id)),
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
    join public.profiles challenged on challenged.id = battle.challenged_id
    where auth.uid() in (battle.challenger_id, battle.challenged_id)
      and battle.status in ('pending', 'active', 'completed')
    order by battle.created_at desc
    limit 100;
end;
$$;

drop function if exists public.get_battle_questions(uuid);
create function public.get_battle_questions(p_battle_id uuid)
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
  if target_quiz_id is null then raise exception 'This battle is not available to your account'; end if;
  insert into public.battle_starts (battle_id, user_id)
  values (p_battle_id, auth.uid())
  on conflict (battle_id, user_id) do nothing;
  return query
    select question.id, question.quiz_id, question.paper_id,
      question.position, question.prompt, question.options, question.explanation
    from public.quiz_set_questions question
    where question.id = any(target_questions)
      and question.paper_id = (
        select quiz.paper_id from public.quiz_sets quiz where quiz.id = target_quiz_id
      )
      and question.paper_id is not null
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
  if battle.status <> 'active' then raise exception 'This battle is not accepting answers'; end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Battle answers are invalid';
  end if;
  if exists (
    select 1 from public.battle_submissions submission
    where submission.battle_id = p_battle_id and submission.user_id = auth.uid()
  ) then raise exception 'You have already submitted this battle'; end if;
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
      and question.paper_id = (
        select quiz.paper_id from public.quiz_sets quiz where quiz.id = battle.quiz_id
      )
      and question.paper_id is not null
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
    if answer_index = quiz_question.correct_index then correct_total := correct_total + 1; end if;
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
       or (this_submission.correct_count = other_submission.correct_count
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
      insert into public.player_game_stats (user_id, points, battles_played, battle_wins, battle_losses,
        current_win_streak, best_win_streak)
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

create or replace function public.get_game_leaderboard(p_university text default null)
returns table (
  user_id uuid,
  full_name text,
  university text,
  points bigint,
  quizzes_completed integer,
  battle_wins integer,
  battle_losses integer,
  current_win_streak integer,
  best_win_streak integer,
  title text
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
    select profile.id, profile.full_name, profile.university,
      coalesce(stats.points, 0), coalesce(stats.quizzes_completed, 0),
      coalesce(stats.battle_wins, 0), coalesce(stats.battle_losses, 0),
      coalesce(stats.current_win_streak, 0), coalesce(stats.best_win_streak, 0),
      case
        when coalesce(stats.best_win_streak, 0) >= 10 then 'Campus Legend'
        when coalesce(stats.best_win_streak, 0) >= 5 then 'On a Roll'
        when coalesce(stats.battle_wins, 0) >= 1 then 'Challenger'
        else 'Rookie'
      end
    from public.profiles profile
    left join public.player_game_stats stats on stats.user_id = profile.id
    where nullif(trim(profile.university), '') is not null
      and (p_university is null or lower(profile.university) = lower(p_university))
      and (stats.user_id is not null or exists (
        select 1 from public.quiz_attempts attempt where attempt.user_id = profile.id
      ))
    order by coalesce(stats.points, 0) desc, coalesce(stats.battle_wins, 0) desc,
      coalesce(stats.best_win_streak, 0) desc, profile.full_name
    limit 100;
end;
$$;

revoke all on function public.current_user_is_suspended_for(uuid) from public, anon;
revoke all on function public.is_published_quiz_source(text) from public, anon;
revoke all on function public.track_legacy_quiz_points() from public, anon, authenticated;
revoke all on function public.admin_list_quiz_sets() from public, anon;
revoke all on function public.admin_list_quiz_papers() from public, anon;
revoke all on function public.admin_get_quiz_draft(uuid) from public, anon;
revoke all on function public.admin_save_quiz_draft(uuid, text, text, uuid, jsonb, text, text) from public, anon;
revoke all on function public.admin_request_quiz_review(uuid) from public, anon;
revoke all on function public.admin_review_quiz_set(uuid, text) from public, anon;
revoke all on function public.get_published_quiz_sets() from public, anon;
revoke all on function public.get_quiz_set_questions(uuid) from public, anon;
revoke all on function public.submit_quiz_set_attempt(uuid, jsonb, integer) from public, anon;
revoke all on function public.get_my_quiz_set_attempts() from public, anon;
revoke all on function public.search_battle_opponents(text) from public, anon;
revoke all on function public.create_battle_challenge(uuid, uuid) from public, anon;
revoke all on function public.respond_to_battle_challenge(uuid, boolean) from public, anon;
revoke all on function public.cancel_battle_challenge(uuid) from public, anon;
revoke all on function public.list_my_battles() from public, anon;
revoke all on function public.get_battle_questions(uuid) from public, anon;
revoke all on function public.submit_battle_attempt(uuid, jsonb) from public, anon;
revoke all on function public.get_game_leaderboard(text) from public, anon;

grant execute on function public.is_published_quiz_source(text) to authenticated;
grant execute on function public.admin_list_quiz_sets() to authenticated;
grant execute on function public.admin_list_quiz_papers() to authenticated;
grant execute on function public.admin_get_quiz_draft(uuid) to authenticated;
grant execute on function public.admin_save_quiz_draft(uuid, text, text, uuid, jsonb, text, text) to authenticated;
grant execute on function public.admin_request_quiz_review(uuid) to authenticated;
grant execute on function public.admin_review_quiz_set(uuid, text) to authenticated;
grant execute on function public.get_published_quiz_sets() to authenticated;
grant execute on function public.get_quiz_set_questions(uuid) to authenticated;
grant execute on function public.submit_quiz_set_attempt(uuid, jsonb, integer) to authenticated;
grant execute on function public.get_my_quiz_set_attempts() to authenticated;
grant execute on function public.search_battle_opponents(text) to authenticated;
grant execute on function public.create_battle_challenge(uuid, uuid) to authenticated;
grant execute on function public.respond_to_battle_challenge(uuid, boolean) to authenticated;
grant execute on function public.cancel_battle_challenge(uuid) to authenticated;
grant execute on function public.list_my_battles() to authenticated;
grant execute on function public.get_battle_questions(uuid) to authenticated;
grant execute on function public.submit_battle_attempt(uuid, jsonb) to authenticated;
grant execute on function public.get_game_leaderboard(text) to authenticated;
