-- Apply after schema.sql, admin-foundation.sql, admin-management.sql,
-- quiz-battles.sql, quiz-random-ten-questions.sql, and quiz-learning-ux.sql.
-- This migration is intentionally not run by the application build.

begin;

alter table public.quiz_set_attempts
  add column if not exists submission_key uuid;

create unique index if not exists quiz_set_attempts_user_submission_key_idx
  on public.quiz_set_attempts (user_id, submission_key)
  where submission_key is not null;

alter table public.contributions
  add column if not exists submission_key uuid;

create unique index if not exists contributions_user_submission_key_idx
  on public.contributions (user_id, submission_key)
  where submission_key is not null;

-- Never allow clients to assign identity or moderation state through direct table writes.
drop policy if exists "allow_public_insert_contributions" on public.contributions;
drop policy if exists "allow_public_select_contributions" on public.contributions;
drop policy if exists "contribution owner reads own rows" on public.contributions;
create policy "contribution owner reads own rows"
  on public.contributions
  for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "contribution authenticated submission only" on public.contributions;
create policy "contribution authenticated submission only"
  on public.contributions as restrictive
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and storage_path like auth.uid()::text || '/%'
  );

revoke all on public.contributions from anon;
revoke insert, update, delete on public.contributions from authenticated;
grant select on public.contributions to authenticated;

-- Supabase enforces these file constraints during Storage uploads.
update storage.buckets
set public = false,
    file_size_limit = 20971520,
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']
where id = 'contributions';

-- Authenticated users can upload only within their own contribution folder.
drop policy if exists "contribution owners may upload" on storage.objects;
create policy "contribution owners may upload"
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contributions'
    and name like auth.uid()::text || '/%'
  );
drop policy if exists "contribution owner upload only" on storage.objects;
create policy "contribution owner upload only"
  on storage.objects as restrictive
  for insert to authenticated
  with check (
    bucket_id <> 'contributions'
    or name like auth.uid()::text || '/%'
  );

-- Replace the non-idempotent 3-argument RPC with one requiring a client-generated
-- retry key. Validation, identity, scoring, and points are all derived server-side.
drop function if exists public.submit_quiz_set_attempt(uuid, jsonb, integer);

create or replace function public.submit_quiz_set_attempt(
  p_quiz_id uuid,
  p_answers jsonb,
  p_duration_seconds integer,
  p_submission_key uuid
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
  existing_attempt public.quiz_set_attempts%rowtype;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if p_submission_key is null then
    raise exception 'A submission key is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(auth.uid()::text || ':' || p_submission_key::text, 0)
  );

  select * into existing_attempt
  from public.quiz_set_attempts attempt
  where attempt.user_id = auth.uid()
    and attempt.submission_key = p_submission_key;
  if found then
    if existing_attempt.quiz_id <> p_quiz_id or existing_attempt.answers <> p_answers then
      raise exception 'This submission key was already used for different answers';
    end if;
    return jsonb_build_object(
      'id', existing_attempt.id,
      'paper_id', (select quiz.paper_id from public.quiz_sets quiz where quiz.id = existing_attempt.quiz_id),
      'quiz_id', existing_attempt.quiz_id,
      'quiz_title', (select quiz.title from public.quiz_sets quiz where quiz.id = existing_attempt.quiz_id),
      'score_percent', existing_attempt.score_percent,
      'correct_count', existing_attempt.correct_count,
      'total_questions', existing_attempt.total_questions,
      'duration_seconds', existing_attempt.duration_seconds,
      'created_at', existing_attempt.created_at,
      'points_earned', existing_attempt.correct_count * 10
    );
  end if;

  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Quiz answers are invalid';
  end if;
  if p_duration_seconds is null or p_duration_seconds < 0 or p_duration_seconds > 86400 then
    raise exception 'Quiz answers or duration are invalid';
  end if;
  if not exists (
    select 1 from public.quiz_sets quiz
    where quiz.id = p_quiz_id and quiz.status = 'published'
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
      and question.paper_id is not distinct from (
        select quiz.paper_id from public.quiz_sets quiz where quiz.id = p_quiz_id
      )
      and question.review_status = 'approved'
      and question.correct_index is not null
  ) <> question_total then
    raise exception 'Answers must match the approved questions in this quiz';
  end if;

  for quiz_question in
    select question.id, question.correct_index, question.options
    from jsonb_object_keys(p_answers) answer_key
    join public.quiz_set_questions question on question.id = answer_key::uuid
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
    if answer_index >= jsonb_array_length(quiz_question.options) then
      raise exception 'An answer does not match its question options';
    end if;
    if answer_index = quiz_question.correct_index then
      correct_total := correct_total + 1;
    end if;
  end loop;

  insert into public.quiz_set_attempts (
    user_id, quiz_id, score_percent, correct_count, total_questions,
    duration_seconds, answers, submission_key
  )
  values (
    auth.uid(), p_quiz_id,
    round(correct_total::numeric * 100 / question_total)::integer,
    correct_total, question_total, p_duration_seconds, p_answers, p_submission_key
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

revoke all on function public.submit_quiz_set_attempt(uuid, jsonb, integer, uuid) from public, anon;
grant execute on function public.submit_quiz_set_attempt(uuid, jsonb, integer, uuid) to authenticated;

-- Contribution identity and status are derived from the verified Supabase session;
-- the uploaded object must belong to that same user and private bucket.
create or replace function public.submit_contribution(
  p_submission_key uuid,
  p_university text,
  p_course_code text,
  p_course_title text,
  p_exam_year integer,
  p_notes text,
  p_question_file_name text,
  p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  existing_contribution public.contributions%rowtype;
  saved_contribution public.contributions%rowtype;
  contributor_name text;
  contributor_email text;
  normalized_university text := trim(coalesce(p_university, ''));
  normalized_course_code text := trim(coalesce(p_course_code, ''));
  normalized_course_title text := trim(coalesce(p_course_title, ''));
  normalized_notes text := trim(coalesce(p_notes, ''));
  normalized_file_name text := trim(coalesce(p_question_file_name, ''));
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if p_submission_key is null then
    raise exception 'A submission key is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(auth.uid()::text || ':' || p_submission_key::text, 0)
  );

  select * into existing_contribution
  from public.contributions contribution
  where contribution.user_id = auth.uid()
    and contribution.submission_key = p_submission_key;
  if found then
    if existing_contribution.university <> normalized_university
      or existing_contribution.course_code <> upper(normalized_course_code)
      or existing_contribution.course_title <> normalized_course_title
      or existing_contribution.exam_year <> p_exam_year
      or coalesce(existing_contribution.notes, '') <> normalized_notes
      or coalesce(existing_contribution.question_file_name, '') <> normalized_file_name then
      raise exception 'This submission key was already used for different contribution details';
    end if;
    return jsonb_build_object(
      'id', existing_contribution.id,
      'course_code', existing_contribution.course_code,
      'course_title', existing_contribution.course_title,
      'exam_year', existing_contribution.exam_year,
      'status', existing_contribution.status,
      'created_at', existing_contribution.created_at,
      'storage_path', existing_contribution.storage_path
    );
  end if;

  if normalized_university = '' or length(normalized_university) > 160
    or normalized_course_code = '' or length(normalized_course_code) > 40
    or normalized_course_title = '' or length(normalized_course_title) > 200
    or p_exam_year is null or p_exam_year < 1990
    or p_exam_year > extract(year from now())::integer
    or length(normalized_notes) > 2000
    or normalized_file_name = '' or length(normalized_file_name) > 255
    or normalized_file_name ~ '[[:cntrl:]]'
    or p_storage_path is null
    or p_storage_path not like auth.uid()::text || '/%' then
    raise exception 'Contribution details or file are invalid';
  end if;

  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'contributions'
      and object.name = p_storage_path
      and object.owner_id = auth.uid()::text
  ) then
    raise exception 'The uploaded file is not owned by this account';
  end if;

  select coalesce(
    nullif(trim(profile.full_name), ''),
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''),
    'Student'
  ) into contributor_name
  from public.profiles profile
  where profile.id = auth.uid();
  contributor_name := coalesce(
    contributor_name,
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''),
    'Student'
  );
  contributor_email := nullif(trim(auth.jwt() ->> 'email'), '');
  if contributor_email is null then
    raise exception 'A verified account email is required' using errcode = '42501';
  end if;

  insert into public.contributions (
    user_id, name, email, university, course_code, course_title,
    exam_year, notes, question_file_name, storage_path, status, submission_key
  )
  values (
    auth.uid(), contributor_name, contributor_email, normalized_university,
    upper(normalized_course_code), normalized_course_title, p_exam_year,
    nullif(normalized_notes, ''), normalized_file_name, p_storage_path, 'pending', p_submission_key
  )
  returning * into saved_contribution;

  return jsonb_build_object(
    'id', saved_contribution.id,
    'course_code', saved_contribution.course_code,
    'course_title', saved_contribution.course_title,
    'exam_year', saved_contribution.exam_year,
    'status', saved_contribution.status,
    'created_at', saved_contribution.created_at,
    'storage_path', saved_contribution.storage_path
  );
end;
$$;

revoke all on function public.submit_contribution(uuid, text, text, text, integer, text, text, text)
  from public, anon;
grant execute on function public.submit_contribution(uuid, text, text, text, integer, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
