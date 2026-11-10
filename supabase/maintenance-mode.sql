-- Run after admin-foundation.sql. This adds a public read-only status endpoint,
-- a Super Admin-only control, and database-level access gating during maintenance.

create table if not exists public.site_maintenance (
  id integer primary key default 1 check (id = 1),
  is_active boolean not null default false,
  title text not null default 'We’ll be back soon',
  message text not null default 'We’re making Rimbly better. Your account and progress are safe.',
  ends_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (not is_active or ends_at is not null)
);

insert into public.site_maintenance (id)
values (1)
on conflict (id) do nothing;

alter table public.site_maintenance enable row level security;
revoke all on public.site_maintenance from public, anon, authenticated;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.admin_memberships membership
    where membership.user_id = auth.uid()
      and membership.role_id = 'super_admin'
      and membership.status = 'active'
  );
$$;

create or replace function public.maintenance_app_access_allowed()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select not exists (
    select 1
    from public.site_maintenance maintenance
    where maintenance.id = 1
      and maintenance.is_active
      and maintenance.ends_at > now()
  ) or public.is_super_admin();
$$;

create or replace function public.has_admin_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.is_super_admin()
    or (
      public.maintenance_app_access_allowed()
      and (
        exists (
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
        )
        or exists (
          select 1
          from public.admin_memberships membership
          join public.admin_membership_permissions override_permission
            on override_permission.membership_id = membership.id
          where membership.user_id = auth.uid()
            and membership.status = 'active'
            and override_permission.permission_id = p_permission
            and override_permission.granted
        )
      )
    );
$$;

create or replace function public.get_maintenance_status()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'active', maintenance.is_active and maintenance.ends_at > now(),
    'title', maintenance.title,
    'message', maintenance.message,
    'ends_at', maintenance.ends_at,
    'updated_at', maintenance.updated_at
  )
  from public.site_maintenance maintenance
  where maintenance.id = 1;
$$;

create or replace function public.set_maintenance_status(
  p_active boolean,
  p_ends_at timestamptz,
  p_title text default 'We’ll be back soon',
  p_message text default 'We’re making Rimbly better. Your account and progress are safe.'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_state public.site_maintenance%rowtype;
  next_state public.site_maintenance%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can change maintenance mode' using errcode = '42501';
  end if;
  if p_active and (p_ends_at is null or p_ends_at <= now()) then
    raise exception 'Choose a maintenance end time in the future';
  end if;
  if nullif(trim(p_title), '') is null or length(trim(p_title)) > 100 then
    raise exception 'Enter a maintenance title of 1 to 100 characters';
  end if;
  if nullif(trim(p_message), '') is null or length(trim(p_message)) > 500 then
    raise exception 'Enter a maintenance message of 1 to 500 characters';
  end if;

  select * into previous_state from public.site_maintenance where id = 1 for update;

  insert into public.site_maintenance (id, is_active, title, message, ends_at, updated_by, updated_at)
  values (
    1,
    p_active,
    trim(p_title),
    trim(p_message),
    case when p_active then p_ends_at else null end,
    auth.uid(),
    now()
  )
  on conflict (id) do update set
    is_active = excluded.is_active,
    title = excluded.title,
    message = excluded.message,
    ends_at = excluded.ends_at,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into next_state;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(),
    case when p_active then 'maintenance.enabled' else 'maintenance.disabled' end,
    'site_maintenance',
    '1',
    jsonb_build_object(
      'was_active', previous_state.is_active and previous_state.ends_at > now(),
      'active', next_state.is_active,
      'title', next_state.title,
      'ends_at', next_state.ends_at
    )
  );

  return public.get_maintenance_status();
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'profiles',
    'universities',
    'courses',
    'papers',
    'quiz_attempts',
    'saved_courses',
    'notifications',
    'contributions',
    'suggestions'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format('alter table public.%I enable row level security', target_table);
      execute format('drop policy if exists "maintenance access gate" on public.%I', target_table);
      execute format(
        'create policy "maintenance access gate" on public.%I as restrictive for all to authenticated, anon using (public.maintenance_app_access_allowed()) with check (public.maintenance_app_access_allowed())',
        target_table
      );
    end if;
  end loop;
end;
$$;

create or replace function public.prevent_maintenance_quiz_writes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.maintenance_app_access_allowed() then
    raise exception 'Quiz submissions are disabled during website maintenance'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.quiz_attempts') is not null then
    execute 'drop trigger if exists "maintenance quiz write gate" on public.quiz_attempts';
    execute 'create trigger "maintenance quiz write gate"
      before insert or update or delete on public.quiz_attempts
      for each row execute function public.prevent_maintenance_quiz_writes()';
  end if;
end;
$$;

drop policy if exists "maintenance contribution storage gate" on storage.objects;
create policy "maintenance contribution storage gate"
on storage.objects as restrictive for all to authenticated
using (
  bucket_id <> 'contributions'
  or public.maintenance_app_access_allowed()
)
with check (
  bucket_id <> 'contributions'
  or public.maintenance_app_access_allowed()
);

revoke all on function public.is_super_admin() from public, anon;
revoke all on function public.maintenance_app_access_allowed() from public, anon;
revoke all on function public.has_admin_permission(text) from public, anon;
revoke all on function public.prevent_maintenance_quiz_writes() from public, anon;
revoke all on function public.get_maintenance_status() from public;
revoke all on function public.set_maintenance_status(boolean, timestamptz, text, text) from public, anon;

grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.maintenance_app_access_allowed() to authenticated, anon;
grant execute on function public.has_admin_permission(text) to authenticated;
grant execute on function public.prevent_maintenance_quiz_writes() to authenticated;
grant execute on function public.get_maintenance_status() to anon, authenticated;
grant execute on function public.set_maintenance_status(boolean, timestamptz, text, text) to authenticated;
