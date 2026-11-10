-- Run after the core Rimbly schema in the Supabase SQL Editor.
-- No administrator is created automatically. The initial super admin must be
-- assigned explicitly to a trusted auth.users UUID by the project owner.

create table if not exists public.admin_roles (
  id text primary key,
  name text not null unique
);

create table if not exists public.admin_permissions (
  id text primary key,
  description text not null
);

create table if not exists public.admin_role_permissions (
  role_id text not null references public.admin_roles(id) on delete cascade,
  permission_id text not null references public.admin_permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists public.admin_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role_id text not null references public.admin_roles(id),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended', 'revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_membership_permissions (
  membership_id uuid not null references public.admin_memberships(id) on delete cascade,
  permission_id text not null references public.admin_permissions(id) on delete cascade,
  granted boolean not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key (membership_id, permission_id)
);

create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_actor_id_idx
  on public.admin_audit_logs (actor_id, created_at desc);

insert into public.admin_roles (id, name)
values
  ('super_admin', 'Super Admin'),
  ('admin', 'Admin'),
  ('moderator', 'Moderator')
on conflict (id) do update set name = excluded.name;

insert into public.admin_permissions (id, description)
values
  ('dashboard.access', 'Access the administrative dashboard'),
  ('analytics.view', 'View platform analytics'),
  ('academics.manage', 'Manage universities, departments and courses'),
  ('papers.manage', 'Manage published past papers'),
  ('contributions.review', 'Review and decide on student contributions'),
  ('quiz.manage', 'Manage quiz questions and content'),
  ('quiz.review', 'Review assigned quiz content'),
  ('battles.moderate', 'Moderate battles and reports'),
  ('students.manage', 'Manage student accounts'),
  ('students.review', 'Review assigned student reports'),
  ('community.moderate', 'Moderate community content and reports'),
  ('team.manage', 'Invite administrators and manage privileged roles'),
  ('settings.manage', 'Manage platform-wide settings'),
  ('audit.view', 'Read administrative audit logs')
on conflict (id) do update set description = excluded.description;

insert into public.admin_role_permissions (role_id, permission_id)
select 'super_admin', id from public.admin_permissions
on conflict do nothing;

insert into public.admin_role_permissions (role_id, permission_id)
select 'admin', id
from public.admin_permissions
where id not in ('team.manage', 'settings.manage')
on conflict do nothing;

insert into public.admin_role_permissions (role_id, permission_id)
values
  ('moderator', 'dashboard.access'),
  ('moderator', 'contributions.review'),
  ('moderator', 'papers.manage'),
  ('moderator', 'quiz.review'),
  ('moderator', 'students.review'),
  ('moderator', 'audit.view')
on conflict do nothing;

alter table public.admin_roles enable row level security;
alter table public.admin_permissions enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_memberships enable row level security;
alter table public.admin_membership_permissions enable row level security;
alter table public.admin_audit_logs enable row level security;

revoke all on public.admin_roles, public.admin_permissions, public.admin_role_permissions,
  public.admin_memberships, public.admin_membership_permissions, public.admin_audit_logs
  from anon, authenticated;

create or replace function public.has_admin_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.admin_memberships membership
    join public.admin_role_permissions role_permission
      on role_permission.role_id = membership.role_id
    where membership.user_id = auth.uid()
      and membership.status = 'active'
      and role_permission.permission_id = p_permission
      and not exists (
        select 1
        from public.admin_membership_permissions override_permission
        where override_permission.membership_id = membership.id
          and override_permission.permission_id = p_permission
      )
  ) or exists (
    select 1
    from public.admin_memberships membership
    join public.admin_membership_permissions override_permission
      on override_permission.membership_id = membership.id
    where membership.user_id = auth.uid()
      and membership.status = 'active'
      and override_permission.permission_id = p_permission
      and override_permission.granted
  );
$$;

create or replace function public.admin_get_access()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'role', membership.role_id,
    'permissions', coalesce((
      select jsonb_agg(permission.id order by permission.id)
      from public.admin_permissions permission
      where public.has_admin_permission(permission.id)
    ), '[]'::jsonb)
  )
  from public.admin_memberships membership
  where membership.user_id = auth.uid()
    and membership.status = 'active'
  limit 1;
$$;

create or replace function public.admin_get_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.has_admin_permission('dashboard.access') then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'students', (select count(*) from public.profiles),
    'courses', (select count(*) from public.courses),
    'published_papers', (select count(*) from public.papers where status = 'approved'),
    'pending_contributions', (select count(*) from public.contributions where status = 'pending'),
    'quiz_attempts', (select count(*) from public.quiz_attempts),
    'active_admins', (
      select count(*) from public.admin_memberships
      where status = 'active'
    )
  );
end;
$$;

create or replace function public.admin_list_contributions()
returns table (
  id uuid,
  user_id uuid,
  contributor_name text,
  contributor_email text,
  university text,
  course_code text,
  course_title text,
  level text,
  semester text,
  exam_year integer,
  academic_session text,
  notes text,
  question_file_name text,
  storage_path text,
  status text,
  rejection_reason text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.has_admin_permission('contributions.review') then
    raise exception 'Contribution review permission is required' using errcode = '42501';
  end if;

  return query
    select contribution.id,
      contribution.user_id,
      contribution.name,
      contribution.email,
      contribution.university,
      contribution.course_code,
      contribution.course_title,
      contribution.level,
      contribution.semester,
      contribution.exam_year,
      contribution.academic_session,
      contribution.notes,
      contribution.question_file_name,
      contribution.storage_path,
      contribution.status::text,
      contribution.rejection_reason,
      contribution.created_at
    from public.contributions contribution
    order by (contribution.status = 'pending') desc, contribution.created_at desc;
end;
$$;

alter table public.contributions
  add column if not exists rejection_reason text,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists level text,
  add column if not exists semester text,
  add column if not exists academic_session text;

alter table public.notifications
  add column if not exists type text not null default 'platform';

alter table public.papers
  add column if not exists contribution_id uuid references public.contributions(id) on delete set null;

create unique index if not exists papers_contribution_id_unique_idx
  on public.papers (contribution_id)
  where contribution_id is not null;

create or replace function public.admin_review_contribution(
  p_contribution_id uuid,
  p_decision text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  contribution_record public.contributions%rowtype;
  target_course_id uuid;
begin
  if not public.has_admin_permission('contributions.review') then
    raise exception 'Contribution review permission is required' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;
  if p_decision = 'rejected' and nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required when rejecting a contribution';
  end if;

  select * into contribution_record
  from public.contributions
  where id = p_contribution_id
  for update;
  if not found then
    raise exception 'Contribution not found';
  end if;
  if contribution_record.status <> 'pending' then
    raise exception 'Only pending contributions can be reviewed';
  end if;
  if p_decision = 'approved' and nullif(trim(contribution_record.storage_path), '') is null then
    raise exception 'A contribution must have an uploaded document before approval';
  end if;

  update public.contributions
  set status = p_decision,
      rejection_reason = case when p_decision = 'rejected' then trim(p_reason) else null end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_contribution_id;

  if p_decision = 'approved' then
    perform pg_advisory_xact_lock(
      hashtextextended(
        lower(trim(contribution_record.university)) || ':' || lower(trim(contribution_record.course_code)),
        0
      )
    );

    select course.id into target_course_id
    from public.courses course
    where lower(course.university) = lower(trim(contribution_record.university))
      and lower(course.code) = lower(trim(contribution_record.course_code))
    order by course.id
    limit 1;

    if target_course_id is null then
      insert into public.courses (university, code, title, level, semester, is_verified)
      values (
        contribution_record.university,
        upper(trim(contribution_record.course_code)),
        contribution_record.course_title,
        contribution_record.level,
        contribution_record.semester,
        true
      )
      returning id into target_course_id;
    end if;

    insert into public.papers (
      course_id,
      academic_session,
      semester,
      exam_year,
      file_path,
      is_verified,
      status,
      contribution_id
    )
    values (
      target_course_id,
      coalesce(
        nullif(trim(contribution_record.academic_session), ''),
        contribution_record.exam_year::text || '/' || (contribution_record.exam_year + 1)::text
      ),
      contribution_record.semester,
      contribution_record.exam_year,
      contribution_record.storage_path,
      true,
      'approved',
      contribution_record.id
    )
    on conflict (contribution_id) where contribution_id is not null do nothing;
  end if;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(),
    case when p_decision = 'approved' then 'contribution.approved' else 'contribution.rejected' end,
    'contribution',
    p_contribution_id::text,
    jsonb_build_object(
      'course_code', contribution_record.course_code,
      'course_title', contribution_record.course_title,
      'decision', p_decision,
      'reason', case when p_decision = 'rejected' then trim(p_reason) else null end
    )
  );

  insert into public.notifications (user_id, title, body, type)
  values (
    contribution_record.user_id,
    case when p_decision = 'approved' then 'Contribution approved' else 'Contribution needs changes' end,
    case
      when p_decision = 'approved' then contribution_record.course_code || ' was approved and is now available in the Rimbly library.'
      else contribution_record.course_code || ' was not approved: ' || trim(p_reason)
    end,
    'contribution'
  );
end;
$$;

create or replace function public.admin_list_audit_logs(p_limit integer default 50)
returns table (
  id bigint,
  actor_id uuid,
  actor_name text,
  action text,
  resource_type text,
  resource_id text,
  details jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.has_admin_permission('audit.view') then
    raise exception 'Audit log permission is required' using errcode = '42501';
  end if;

  return query
    select audit.id,
      audit.actor_id,
      coalesce(profile.full_name, 'System'),
      audit.action,
      audit.resource_type,
      audit.resource_id,
      audit.details,
      audit.created_at
    from public.admin_audit_logs audit
    left join public.profiles profile on profile.id = audit.actor_id
    order by audit.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

create or replace function public.is_published_contribution_file(p_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.papers
    where file_path = p_path and status = 'approved'
  );
$$;

revoke all on function public.has_admin_permission(text) from public, anon;
revoke all on function public.admin_get_access() from public, anon;
revoke all on function public.admin_get_overview() from public, anon;
revoke all on function public.admin_list_contributions() from public, anon;
revoke all on function public.admin_review_contribution(uuid, text, text) from public, anon;
revoke all on function public.admin_list_audit_logs(integer) from public, anon;
revoke all on function public.is_published_contribution_file(text) from public, anon;
grant execute on function public.has_admin_permission(text) to authenticated;
grant execute on function public.admin_get_access() to authenticated;
grant execute on function public.admin_get_overview() to authenticated;
grant execute on function public.admin_list_contributions() to authenticated;
grant execute on function public.admin_review_contribution(uuid, text, text) to authenticated;
grant execute on function public.admin_list_audit_logs(integer) to authenticated;
grant execute on function public.is_published_contribution_file(text) to authenticated;

drop policy if exists "admin contribution visibility" on public.contributions;
drop policy if exists "admin may read contribution rows" on public.contributions;
alter table public.contributions enable row level security;
create policy "admin contribution visibility"
on public.contributions as restrictive for select to authenticated
using (user_id = auth.uid() or public.has_admin_permission('contributions.review'));
create policy "admin may read contribution rows"
on public.contributions for select to authenticated
using (public.has_admin_permission('contributions.review'));

revoke all on public.contributions from anon;
revoke update, delete on public.contributions from authenticated;
grant select, insert on public.contributions to authenticated;

-- Keep uploaded contribution files private; only the owner and reviewers may
-- request signed download URLs.
update storage.buckets set public = false where id = 'contributions';

drop policy if exists "admin contribution file visibility" on storage.objects;
drop policy if exists "admin and published contribution files" on storage.objects;
create policy "admin contribution file visibility"
on storage.objects as restrictive for select to authenticated
using (
  bucket_id <> 'contributions'
  or owner_id = auth.uid()::text
  or public.has_admin_permission('contributions.review')
  or public.is_published_contribution_file(name)
);
create policy "admin and published contribution files"
on storage.objects for select to authenticated
using (
  bucket_id = 'contributions'
  and (
    public.has_admin_permission('contributions.review')
    or public.is_published_contribution_file(name)
  )
);

drop policy if exists "contribution owner upload only" on storage.objects;
create policy "contribution owner upload only"
on storage.objects as restrictive for insert to authenticated
with check (
  bucket_id <> 'contributions'
  or name like auth.uid()::text || '/%'
);

-- Bootstrap once, after replacing the UUID with a trusted existing auth.users.id:
-- insert into public.admin_memberships (user_id, role_id, accepted_at)
-- values ('00000000-0000-0000-0000-000000000000', 'super_admin', now());
