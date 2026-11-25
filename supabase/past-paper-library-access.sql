create table if not exists public.past_paper_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references public.papers(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (user_id, paper_id)
);

create table if not exists public.past_paper_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references public.papers(id) on delete cascade,
  last_page integer not null check (last_page >= 1),
  page_count integer not null check (page_count >= 1),
  progress_percent integer not null check (progress_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, paper_id)
);

alter table public.past_paper_access enable row level security;
alter table public.past_paper_progress enable row level security;
revoke all on public.past_paper_access from public, anon, authenticated;
revoke all on public.past_paper_progress from public, anon, authenticated;

create or replace function public.get_my_library_access_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  active_pro boolean;
  active_admin boolean;
  papers_used integer;
begin
  if current_user_id is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  active_pro := public.is_rimbly_pro_active(current_user_id);
  active_admin := public.has_admin_permission('papers.manage')
    or public.has_admin_permission('contributions.review');
  select count(*)::integer into papers_used
  from public.past_paper_access
  where user_id = current_user_id;

  return jsonb_build_object(
    'is_pro', active_pro,
    'is_admin', active_admin,
    'documents_used', coalesce(papers_used, 0),
    'free_document_limit', 3,
    'documents_remaining', case
      when active_pro or active_admin then null
      else greatest(0, 3 - coalesce(papers_used, 0))
    end
  );
end;
$$;

create or replace function public.request_past_paper_access(p_paper_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  active_pro boolean;
  active_admin boolean;
  papers_used integer;
begin
  if current_user_id is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.papers paper
    where paper.id = p_paper_id and paper.status = 'approved'
  ) then
    raise exception 'This past paper is unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 3));
  active_pro := public.is_rimbly_pro_active(current_user_id);
  active_admin := public.has_admin_permission('papers.manage')
    or public.has_admin_permission('contributions.review');

  if active_admin then
    select count(*)::integer into papers_used
    from public.past_paper_access
    where user_id = current_user_id;
    return jsonb_build_object(
      'allowed', true,
      'reason', 'admin',
      'is_pro', active_pro,
      'is_admin', true,
      'documents_used', coalesce(papers_used, 0),
      'free_document_limit', 3
    );
  end if;

  if exists (
    select 1
    from public.past_paper_access access
    where access.user_id = current_user_id and access.paper_id = p_paper_id
  ) then
    select count(*)::integer into papers_used
    from public.past_paper_access
    where user_id = current_user_id;
    return jsonb_build_object(
      'allowed', true,
      'reason', 'previously_unlocked',
      'is_pro', active_pro,
      'is_admin', false,
      'documents_used', papers_used,
      'free_document_limit', 3
    );
  end if;

  if active_pro then
    select count(*)::integer into papers_used
    from public.past_paper_access
    where user_id = current_user_id;
    return jsonb_build_object(
      'allowed', true,
      'reason', 'pro',
      'is_pro', true,
      'is_admin', false,
      'documents_used', coalesce(papers_used, 0),
      'free_document_limit', 3
    );
  end if;

  select count(*)::integer into papers_used
  from public.past_paper_access
  where user_id = current_user_id;

  if papers_used >= 3 then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'free_limit_reached',
      'is_pro', false,
      'is_admin', false,
      'documents_used', papers_used,
      'free_document_limit', 3
    );
  end if;

  insert into public.past_paper_access (user_id, paper_id)
  values (current_user_id, p_paper_id);
  papers_used := papers_used + 1;

  return jsonb_build_object(
    'allowed', true,
    'reason', 'free_allowance',
    'is_pro', false,
    'is_admin', false,
    'documents_used', papers_used,
    'free_document_limit', 3
  );
end;
$$;

create or replace function public.can_access_past_paper(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and not public.current_user_is_suspended()
    and exists (
      select 1
      from public.papers paper
      where paper.file_path = p_storage_path
        and paper.status = 'approved'
        and (
          public.is_rimbly_pro_active(auth.uid())
          or exists (
            select 1
            from public.past_paper_access access
            where access.user_id = auth.uid()
              and access.paper_id = paper.id
          )
          or public.has_admin_permission('papers.manage')
          or public.has_admin_permission('contributions.review')
        )
    );
$$;

create or replace function public.get_past_paper_reader_path(p_paper_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  paper_path text;
begin
  if current_user_id is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  select paper.file_path into paper_path
  from public.papers paper
  where paper.id = p_paper_id
    and paper.status = 'approved'
    and (
      public.is_rimbly_pro_active(current_user_id)
      or exists (
        select 1
        from public.past_paper_access access
        where access.user_id = current_user_id and access.paper_id = paper.id
      )
      or public.has_admin_permission('papers.manage')
      or public.has_admin_permission('contributions.review')
    );
  if paper_path is null then
    raise exception 'This past paper is not unlocked';
  end if;
  return paper_path;
end;
$$;

create or replace function public.get_my_past_paper_progress(p_paper_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null or not public.can_access_past_paper(
    (select paper.file_path from public.papers paper where paper.id = p_paper_id)
  ) then
    raise exception 'This past paper is not unlocked';
  end if;
  return coalesce(
    (
      select jsonb_build_object(
        'last_page', progress.last_page,
        'page_count', progress.page_count,
        'progress_percent', progress.progress_percent
      )
      from public.past_paper_progress progress
      where progress.user_id = current_user_id and progress.paper_id = p_paper_id
    ),
    jsonb_build_object('last_page', 1, 'page_count', 1, 'progress_percent', 0)
  );
end;
$$;

create or replace function public.save_past_paper_progress(
  p_paper_id uuid,
  p_last_page integer,
  p_page_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  safe_last_page integer;
  progress_percent integer;
begin
  if current_user_id is null
    or p_last_page is null
    or p_page_count is null
    or p_last_page < 1
    or p_page_count < 1
    or not public.can_access_past_paper(
      (select paper.file_path from public.papers paper where paper.id = p_paper_id)
    )
  then
    raise exception 'This past paper is not unlocked';
  end if;
  safe_last_page := least(p_last_page, p_page_count);
  progress_percent := least(100, greatest(0, round(safe_last_page::numeric * 100 / p_page_count)));
  insert into public.past_paper_progress (
    user_id, paper_id, last_page, page_count, progress_percent, updated_at
  )
  values (current_user_id, p_paper_id, safe_last_page, p_page_count, progress_percent, now())
  on conflict (user_id, paper_id) do update
  set last_page = greatest(public.past_paper_progress.last_page, excluded.last_page),
      page_count = excluded.page_count,
      progress_percent = greatest(public.past_paper_progress.progress_percent, excluded.progress_percent),
      updated_at = now();
  return jsonb_build_object('last_page', safe_last_page, 'progress_percent', progress_percent);
end;
$$;

revoke all on function public.get_my_library_access_status() from public, anon;
revoke all on function public.request_past_paper_access(uuid) from public, anon;
revoke all on function public.can_access_past_paper(text) from public, anon;
revoke all on function public.get_past_paper_reader_path(uuid) from public, anon;
revoke all on function public.get_my_past_paper_progress(uuid) from public, anon;
revoke all on function public.save_past_paper_progress(uuid, integer, integer) from public, anon;
grant execute on function public.get_my_library_access_status() to authenticated;
grant execute on function public.request_past_paper_access(uuid) to authenticated;
grant execute on function public.can_access_past_paper(text) to authenticated;
grant execute on function public.get_past_paper_reader_path(uuid) to authenticated;
grant execute on function public.get_my_past_paper_progress(uuid) to authenticated;
grant execute on function public.save_past_paper_progress(uuid, integer, integer) to authenticated;

drop policy if exists "admin contribution file visibility" on storage.objects;
drop policy if exists "admin and published contribution files" on storage.objects;
drop policy if exists "Approved past papers require an unlocked entitlement"
  on storage.objects;
create policy "Approved past papers require an unlocked entitlement"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'contributions'
    and (
      owner_id = auth.uid()::text
      or public.has_admin_permission('papers.manage')
      or public.has_admin_permission('contributions.review')
      or public.can_access_past_paper(name)
    )
  );

notify pgrst, 'reload schema';
