-- Run after admin-foundation.sql. Requires the core Rimbly tables and the
-- admin roles, memberships, permissions, and audit log created by that file.

alter table public.admin_memberships
  add column if not exists invited_email text;

insert into public.admin_role_permissions (role_id, permission_id)
values
  ('admin', 'team.manage'),
  ('admin', 'students.manage'),
  ('admin', 'papers.manage'),
  ('admin', 'quiz.manage'),
  ('admin', 'analytics.view')
on conflict do nothing;

create table if not exists public.admin_user_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  suspended boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.admin_user_controls enable row level security;
revoke all on public.admin_user_controls from anon, authenticated;

create or replace function public.current_user_is_suspended()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.admin_user_controls control
    where control.user_id = auth.uid()
      and control.suspended
  );
$$;

revoke all on function public.current_user_is_suspended() from public, anon;
grant execute on function public.current_user_is_suspended() to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'contributions',
    'suggestions',
    'notifications',
    'saved_courses',
    'quiz_attempts'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "active account required" on public.%I', table_name);
    execute format(
      'create policy "active account required" on public.%I as restrictive for all to authenticated using (not public.current_user_is_suspended()) with check (not public.current_user_is_suspended())',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.admin_record_invitation(
  p_user_id uuid,
  p_email text,
  p_role_id text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_role text;
  existing_status text;
  target_email text;
begin
  if not public.has_admin_permission('team.manage') then
    raise exception 'Team management permission is required' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot invite yourself';
  end if;
  select lower(email) into target_email from auth.users where id = p_user_id;
  if target_email is null or target_email <> lower(trim(p_email)) then
    raise exception 'The invitation email must match the target account';
  end if;
  if p_role_id not in ('admin', 'moderator', 'super_admin') then
    raise exception 'Unknown administrator role';
  end if;

  select role_id into actor_role
  from public.admin_memberships
  where user_id = auth.uid() and status = 'active';

  if p_role_id = 'super_admin' and actor_role <> 'super_admin' then
    raise exception 'Only a Super Admin can invite another Super Admin' using errcode = '42501';
  end if;
  if actor_role = 'admin' and p_role_id not in ('admin', 'moderator') then
    raise exception 'Admins may invite Admins or Moderators only' using errcode = '42501';
  end if;

  select status into existing_status
  from public.admin_memberships
  where user_id = p_user_id
  for update;
  if existing_status is not null and existing_status not in ('revoked', 'suspended') then
    raise exception 'This account already has an administrator membership';
  end if;

  insert into public.admin_memberships (
    user_id, role_id, status, invited_by, invited_at, accepted_at, invited_email
  )
  values (
    p_user_id, p_role_id, 'invited', auth.uid(), now(), null, lower(trim(p_email))
  )
  on conflict (user_id) do update set
    role_id = excluded.role_id,
    status = 'invited',
    invited_by = excluded.invited_by,
    invited_at = excluded.invited_at,
    accepted_at = null,
    invited_email = excluded.invited_email;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(),
    'team.invited',
    'admin_membership',
    p_user_id::text,
    jsonb_build_object('email', lower(trim(p_email)), 'role', p_role_id)
  );
end;
$$;

create or replace function public.admin_accept_invitation()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  invited_membership public.admin_memberships%rowtype;
begin
  select * into invited_membership
  from public.admin_memberships
  where user_id = auth.uid()
    and status = 'invited'
    and invited_email = lower(auth.jwt() ->> 'email')
    and exists (
      select 1 from auth.users verified_user
      where verified_user.id = auth.uid()
        and verified_user.email_confirmed_at is not null
        and lower(verified_user.email) = lower(auth.jwt() ->> 'email')
    )
  for update;

  if not found then
    return null;
  end if;

  update public.admin_memberships
  set status = 'active', accepted_at = now()
  where id = invited_membership.id;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(),
    'team.invitation_accepted',
    'admin_membership',
    invited_membership.id::text,
    jsonb_build_object('role', invited_membership.role_id)
  );

  return jsonb_build_object('role', invited_membership.role_id);
end;
$$;

create or replace function public.admin_list_team()
returns table (
  user_id uuid,
  email text,
  full_name text,
  role_id text,
  status text,
  invited_by uuid,
  created_at timestamptz,
  accepted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.has_admin_permission('team.manage') then
    raise exception 'Team management permission is required' using errcode = '42501';
  end if;

  return query
    select membership.user_id,
      coalesce(membership.invited_email, auth_user.email),
      profile.full_name,
      membership.role_id,
      membership.status,
      membership.invited_by,
      membership.created_at,
      membership.accepted_at
    from public.admin_memberships membership
    left join auth.users auth_user on auth_user.id = membership.user_id
    left join public.profiles profile on profile.id = membership.user_id
    order by membership.created_at desc;
end;
$$;

create or replace function public.admin_update_team_member(
  p_user_id uuid,
  p_role_id text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_role text;
  target_role text;
  old_status text;
  target_accepted_at timestamptz;
begin
  if not public.has_admin_permission('team.manage') then
    raise exception 'Team management permission is required' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own administrator access';
  end if;
  if p_role_id not in ('admin', 'moderator', 'super_admin')
     or p_status not in ('active', 'suspended', 'revoked') then
    raise exception 'Invalid role or membership status';
  end if;

  select role_id into actor_role
  from public.admin_memberships
  where user_id = auth.uid() and status = 'active';

  select role_id, status, accepted_at into target_role, old_status, target_accepted_at
  from public.admin_memberships
  where user_id = p_user_id
  for update;
  if not found then
    raise exception 'Administrator membership not found';
  end if;
  if target_role = 'super_admin' and actor_role <> 'super_admin' then
    raise exception 'Only a Super Admin may change a Super Admin membership' using errcode = '42501';
  end if;
  if actor_role = 'admin' and p_role_id = 'super_admin' then
    raise exception 'Admins cannot promote anyone to Super Admin' using errcode = '42501';
  end if;
  if p_status = 'active' and (old_status = 'invited' or target_accepted_at is null) then
    raise exception 'An invitation must be accepted by the invited user before activation';
  end if;

  update public.admin_memberships
  set role_id = p_role_id,
      status = p_status,
      accepted_at = case when p_status = 'active' then coalesce(accepted_at, now()) else accepted_at end
  where user_id = p_user_id;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(),
    'team.membership_updated',
    'admin_membership',
    p_user_id::text,
    jsonb_build_object(
      'old_role', target_role, 'new_role', p_role_id,
      'old_status', old_status, 'new_status', p_status
    )
  );
end;
$$;

create or replace function public.admin_list_students(p_search text default '')
returns table (
  user_id uuid,
  full_name text,
  email text,
  university text,
  department text,
  level text,
  created_at timestamptz,
  suspended boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.has_admin_permission('students.manage') then
    raise exception 'Student management permission is required' using errcode = '42501';
  end if;

  return query
    select profile.id::uuid,
      profile.full_name::text,
      auth_user.email::text,
      profile.university::text,
      profile.department::text,
      profile.level::text,
      profile.created_at::timestamptz,
      coalesce(control.suspended, false)::boolean
    from public.profiles profile
    join auth.users auth_user on auth_user.id = profile.id
    left join public.admin_user_controls control on control.user_id = profile.id
    where profile.id <> auth.uid()
      and (
        nullif(trim(p_search), '') is null
        or profile.full_name ilike '%' || trim(p_search) || '%'
        or auth_user.email ilike '%' || trim(p_search) || '%'
      )
      and not exists (
        select 1 from public.admin_memberships membership
        where membership.user_id = profile.id
          and membership.status in ('active', 'invited')
      )
    order by profile.created_at desc
    limit 100;
end;
$$;

create or replace function public.admin_set_student_suspension(
  p_user_id uuid,
  p_suspended boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  prior_suspension boolean;
begin
  if not public.has_admin_permission('students.manage') then
    raise exception 'Student management permission is required' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() or exists (
    select 1 from public.admin_memberships
    where user_id = p_user_id and status in ('active', 'invited')
  ) then
    raise exception 'Administrator accounts cannot be suspended as students';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Student account not found';
  end if;

  select suspended into prior_suspension
  from public.admin_user_controls
  where user_id = p_user_id;

  insert into public.admin_user_controls (user_id, suspended, updated_by, updated_at)
  values (p_user_id, p_suspended, auth.uid(), now())
  on conflict (user_id) do update set
    suspended = excluded.suspended,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(),
    case when p_suspended then 'student.suspended' else 'student.restored' end,
    'student',
    p_user_id::text,
    jsonb_build_object('was_suspended', coalesce(prior_suspension, false), 'suspended', p_suspended)
  );
end;
$$;

create or replace function public.admin_publish_paper(
  p_university text,
  p_course_code text,
  p_course_title text,
  p_level text,
  p_semester text,
  p_academic_session text,
  p_exam_year integer,
  p_file_path text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_course_id uuid;
  target_paper_id uuid;
begin
  if not public.has_admin_permission('papers.manage') then
    raise exception 'Past paper management permission is required' using errcode = '42501';
  end if;
  if nullif(trim(p_university), '') is null
     or nullif(trim(p_course_code), '') is null
     or nullif(trim(p_course_title), '') is null
     or nullif(trim(p_academic_session), '') is null
     or nullif(trim(p_file_path), '') is null then
    raise exception 'Required paper metadata is missing';
  end if;
  if p_exam_year < 1990 or p_exam_year > extract(year from now())::integer + 1 then
    raise exception 'Exam year is outside the allowed range';
  end if;
  if p_file_path not like auth.uid()::text || '/admin/%' then
    raise exception 'Invalid upload path';
  end if;

  select course.id into target_course_id
  from public.courses course
  where lower(course.university) = lower(trim(p_university))
    and lower(course.code) = lower(trim(p_course_code))
  limit 1
  for update;

  if target_course_id is null then
    insert into public.courses (university, code, title, level, semester, is_verified)
    values (
      trim(p_university), upper(trim(p_course_code)), trim(p_course_title),
      nullif(trim(p_level), ''), nullif(trim(p_semester), ''), true
    )
    returning id into target_course_id;
  end if;

  insert into public.papers (
    course_id, academic_session, semester, exam_year, file_path, is_verified, status
  )
  values (
    target_course_id, trim(p_academic_session), nullif(trim(p_semester), ''),
    p_exam_year, p_file_path, true, 'approved'
  )
  returning id into target_paper_id;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(), 'paper.published', 'paper', target_paper_id::text,
    jsonb_build_object(
      'university', trim(p_university),
      'course_code', upper(trim(p_course_code)),
      'academic_session', trim(p_academic_session)
    )
  );

  return target_paper_id;
end;
$$;

create or replace function public.admin_list_papers()
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
  if not public.has_admin_permission('papers.manage') then
    raise exception 'Past paper management permission is required' using errcode = '42501';
  end if;

  return query
    select paper.id, paper.course_id, course.university, course.code, course.title,
      paper.academic_session, paper.semester, paper.exam_year, paper.file_path,
      paper.status::text, paper.created_at
    from public.papers paper
    join public.courses course on course.id = paper.course_id
    order by paper.created_at desc
    limit 200;
end;
$$;

create or replace function public.admin_list_universities()
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.has_admin_permission('academics.manage') then
    raise exception 'Academic management permission is required' using errcode = '42501';
  end if;
  return query select university.id, university.name
    from public.universities university order by university.name;
end;
$$;

create or replace function public.admin_save_university(p_id uuid, p_name text, p_active boolean)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  saved_id uuid;
begin
  if not public.has_admin_permission('academics.manage') then
    raise exception 'Academic management permission is required' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null then raise exception 'University name is required'; end if;
  if p_id is null then
    insert into public.universities (name, is_active)
    values (trim(p_name), coalesce(p_active, true))
    returning id into saved_id;
  else
    update public.universities set name = trim(p_name), is_active = coalesce(p_active, true)
    where id = p_id returning id into saved_id;
    if not found then raise exception 'University not found'; end if;
  end if;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(), case when p_id is null then 'university.created' else 'university.updated' end,
    'university', saved_id::text, jsonb_build_object('name', trim(p_name), 'active', p_active)
  );
  return saved_id;
end;
$$;

create or replace function public.admin_delete_paper(p_paper_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  paper_record public.papers%rowtype;
begin
  if not public.has_admin_permission('papers.manage') then
    raise exception 'Past paper management permission is required' using errcode = '42501';
  end if;
  select * into paper_record from public.papers where id = p_paper_id for update;
  if not found then raise exception 'Paper not found'; end if;
  delete from public.papers where id = p_paper_id;
  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(), 'paper.deleted', 'paper', p_paper_id::text,
    jsonb_build_object('course_id', paper_record.course_id, 'file_path', paper_record.file_path)
  );
end;
$$;

revoke all on function public.admin_record_invitation(uuid, text, text) from public, anon;
revoke all on function public.admin_accept_invitation() from public, anon;
revoke all on function public.admin_list_team() from public, anon;
revoke all on function public.admin_update_team_member(uuid, text, text) from public, anon;
revoke all on function public.admin_list_students(text) from public, anon;
revoke all on function public.admin_set_student_suspension(uuid, boolean) from public, anon;
revoke all on function public.admin_publish_paper(text, text, text, text, text, text, integer, text) from public, anon;
revoke all on function public.admin_list_papers() from public, anon;
revoke all on function public.admin_list_universities() from public, anon;
revoke all on function public.admin_save_university(uuid, text, boolean) from public, anon;
revoke all on function public.admin_delete_paper(uuid) from public, anon;

grant execute on function public.admin_record_invitation(uuid, text, text) to authenticated;
grant execute on function public.admin_accept_invitation() to authenticated;
grant execute on function public.admin_list_team() to authenticated;
grant execute on function public.admin_update_team_member(uuid, text, text) to authenticated;
grant execute on function public.admin_list_students(text) to authenticated;
grant execute on function public.admin_set_student_suspension(uuid, boolean) to authenticated;
grant execute on function public.admin_publish_paper(text, text, text, text, text, text, integer, text) to authenticated;
grant execute on function public.admin_list_papers() to authenticated;
grant execute on function public.admin_list_universities() to authenticated;
grant execute on function public.admin_save_university(uuid, text, boolean) to authenticated;
grant execute on function public.admin_delete_paper(uuid) to authenticated;
