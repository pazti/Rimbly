create table if not exists public.library_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '',
  file_name text not null check (length(trim(file_name)) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 31457280),
  page_count integer check (page_count is null or page_count > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists library_documents_published_idx
  on public.library_documents (published_at desc)
  where status = 'published';

create table if not exists public.library_document_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.library_documents(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (user_id, document_id)
);

create table if not exists public.library_document_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.library_documents(id) on delete cascade,
  last_page integer not null check (last_page >= 1),
  page_count integer not null check (page_count >= 1),
  progress_percent integer not null check (progress_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, document_id)
);

alter table public.library_documents enable row level security;
alter table public.library_document_access enable row level security;
alter table public.library_document_progress enable row level security;

create table if not exists public.library_conversion_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check (
    event_name in (
      'library_document_open',
      'library_paywall_view',
      'library_document_unlocked',
      'pro_checkout_started',
      'pro_subscription_activated'
    )
  ),
  document_id uuid references public.library_documents(id) on delete set null,
  plan_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists library_conversion_events_created_idx
  on public.library_conversion_events (created_at desc);
create index if not exists library_conversion_events_name_idx
  on public.library_conversion_events (event_name, created_at desc);

alter table public.library_conversion_events enable row level security;
revoke all on public.library_conversion_events from public, anon, authenticated;

revoke all on public.library_documents from public, anon, authenticated;
grant select (
  id, title, description, file_name, mime_type, file_size_bytes,
  status, page_count, published_at, created_at
)
  on public.library_documents to authenticated;
revoke all on public.library_document_access from public, anon, authenticated;
revoke all on public.library_document_progress from public, anon, authenticated;

drop policy if exists "Published library document metadata is visible to users"
  on public.library_documents;
create policy "Published library document metadata is visible to users"
  on public.library_documents for select to authenticated
  using (status = 'published');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library-documents', 'library-documents', false, 31457280, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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
  documents_used integer;
begin
  if current_user_id is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  active_pro := public.is_rimbly_pro_active(current_user_id);
  select count(*)::integer into documents_used
  from public.library_document_access
  where user_id = current_user_id;

  return jsonb_build_object(
    'is_pro', active_pro,
    'documents_used', coalesce(documents_used, 0),
    'free_document_limit', 3,
    'documents_remaining', greatest(0, 3 - coalesce(documents_used, 0))
  );
end;
$$;

create or replace function public.request_library_document_access(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  active_pro boolean;
  documents_used integer;
begin
  if current_user_id is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.library_documents
    where id = p_document_id and status = 'published'
  ) then
    raise exception 'This library document is unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 2));
  active_pro := public.is_rimbly_pro_active(current_user_id);

  if exists (
    select 1
    from public.library_document_access
    where user_id = current_user_id and document_id = p_document_id
  ) then
    select count(*)::integer into documents_used
    from public.library_document_access
    where user_id = current_user_id;
    return jsonb_build_object(
      'allowed', true,
      'reason', 'previously_unlocked',
      'is_pro', active_pro,
      'documents_used', documents_used,
      'free_document_limit', 3
    );
  end if;

  if active_pro then
    select count(*)::integer into documents_used
    from public.library_document_access
    where user_id = current_user_id;
    return jsonb_build_object(
      'allowed', true,
      'reason', 'pro',
      'is_pro', true,
      'documents_used', coalesce(documents_used, 0),
      'free_document_limit', 3
    );
  end if;

  select count(*)::integer into documents_used
  from public.library_document_access
  where user_id = current_user_id;

  if documents_used >= 3 then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'free_limit_reached',
      'is_pro', false,
      'documents_used', documents_used,
      'free_document_limit', 3
    );
  end if;

  insert into public.library_document_access (user_id, document_id)
  values (current_user_id, p_document_id);
  documents_used := documents_used + 1;

  return jsonb_build_object(
    'allowed', true,
    'reason', 'free_allowance',
    'is_pro', false,
    'documents_used', documents_used,
    'free_document_limit', 3
  );
end;
$$;

create or replace function public.can_access_library_document(p_storage_path text)
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
      from public.library_documents document
      where document.storage_path = p_storage_path
        and document.status = 'published'
        and (
          public.is_rimbly_pro_active(auth.uid())
          or exists (
            select 1
            from public.library_document_access access
            where access.user_id = auth.uid()
              and access.document_id = document.id
          )
        )
    );
$$;

create or replace function public.get_library_document_reader_path(p_document_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  document_path text;
begin
  if current_user_id is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  select document.storage_path into document_path
  from public.library_documents document
  where document.id = p_document_id
    and document.status = 'published'
    and (
      public.is_rimbly_pro_active(current_user_id)
      or exists (
        select 1
        from public.library_document_access access
        where access.user_id = current_user_id
          and access.document_id = document.id
      )
    );

  if document_path is null then
    raise exception 'This library document is not unlocked';
  end if;
  return document_path;
end;
$$;

revoke all on function public.get_my_library_access_status() from public, anon;
revoke all on function public.request_library_document_access(uuid) from public, anon;
revoke all on function public.can_access_library_document(text) from public, anon;
grant execute on function public.get_my_library_access_status() to authenticated;
grant execute on function public.request_library_document_access(uuid) to authenticated;
revoke all on function public.get_library_document_reader_path(uuid) from public, anon;
grant execute on function public.can_access_library_document(text) to authenticated;
grant execute on function public.get_library_document_reader_path(uuid) to authenticated;

create or replace function public.save_library_document_progress(
  p_document_id uuid,
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
  safe_page_count integer;
  progress_percent integer;
begin
  if current_user_id is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if p_last_page is null or p_page_count is null or p_last_page < 1 or p_page_count < 1 then
    raise exception 'Invalid document progress';
  end if;

  if not exists (
    select 1
    from public.library_documents document
    where document.id = p_document_id
      and document.status = 'published'
      and (
        public.is_rimbly_pro_active(current_user_id)
        or exists (
          select 1
          from public.library_document_access access
          where access.user_id = current_user_id
            and access.document_id = document.id
        )
      )
  ) then
    raise exception 'This library document is not unlocked';
  end if;

  safe_last_page := least(p_last_page, p_page_count);
  safe_page_count := p_page_count;
  progress_percent := least(100, greatest(0, round(safe_last_page::numeric * 100 / safe_page_count)));

  insert into public.library_document_progress (
    user_id, document_id, last_page, page_count, progress_percent, updated_at
  )
  values (
    current_user_id, p_document_id, safe_last_page, safe_page_count, progress_percent, now()
  )
  on conflict (user_id, document_id) do update
  set last_page = greatest(public.library_document_progress.last_page, excluded.last_page),
      page_count = excluded.page_count,
      progress_percent = greatest(
        public.library_document_progress.progress_percent,
        excluded.progress_percent
      ),
      updated_at = now();

  return jsonb_build_object(
    'last_page', greatest(
      (select progress.last_page from public.library_document_progress progress
       where progress.user_id = current_user_id and progress.document_id = p_document_id),
      safe_last_page
    ),
    'progress_percent', greatest(
      (select progress.progress_percent from public.library_document_progress progress
       where progress.user_id = current_user_id and progress.document_id = p_document_id),
      progress_percent
    )
  );
end;
$$;

create or replace function public.get_my_library_document_progress(p_document_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.library_documents document
    where document.id = p_document_id
      and document.status = 'published'
      and (
        public.is_rimbly_pro_active(current_user_id)
        or exists (
          select 1
          from public.library_document_access access
          where access.user_id = current_user_id
            and access.document_id = document.id
        )
      )
  ) then
    raise exception 'This library document is not unlocked';
  end if;

  return coalesce(
    (
      select jsonb_build_object(
        'last_page', progress.last_page,
        'page_count', progress.page_count,
        'progress_percent', progress.progress_percent,
        'updated_at', progress.updated_at
      )
      from public.library_document_progress progress
      where progress.user_id = current_user_id
        and progress.document_id = p_document_id
    ),
    jsonb_build_object(
      'last_page', 1,
      'page_count', 1,
      'progress_percent', 0,
      'updated_at', null
    )
  );
end;
$$;

revoke all on function public.save_library_document_progress(uuid, integer, integer) from public, anon;
revoke all on function public.get_my_library_document_progress(uuid) from public, anon;
grant execute on function public.save_library_document_progress(uuid, integer, integer) to authenticated;
grant execute on function public.get_my_library_document_progress(uuid) to authenticated;

create or replace function public.record_library_conversion_event(
  p_event_name text,
  p_document_id uuid default null,
  p_plan_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  event_id bigint;
begin
  if current_user_id is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if p_event_name not in (
    'library_document_open',
    'library_paywall_view',
    'library_document_unlocked',
    'pro_checkout_started',
    'pro_subscription_activated'
  ) then
    raise exception 'Invalid conversion event';
  end if;

  insert into public.library_conversion_events (
    user_id, event_name, document_id, plan_id, metadata
  )
  values (
    current_user_id,
    p_event_name,
    p_document_id,
    nullif(trim(p_plan_id), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into event_id;
  return event_id;
end;
$$;

revoke all on function public.record_library_conversion_event(text, uuid, text, jsonb) from public, anon;
grant execute on function public.record_library_conversion_event(text, uuid, text, jsonb) to authenticated;

create or replace function public.track_library_subscription_activation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'active' and new.expires_at > now() then
      insert into public.library_conversion_events (
        user_id, event_name, plan_id, metadata
      )
      values (
        new.user_id,
        'pro_subscription_activated',
        new.plan_id,
        jsonb_build_object('source', 'verified_subscription')
      );
      end if;
  elsif new.status = 'active'
    and new.expires_at > now()
    and (
      old.status is distinct from 'active'
      or old.expires_at is distinct from new.expires_at
    )
  then
    insert into public.library_conversion_events (
      user_id, event_name, plan_id, metadata
    )
    values (
      new.user_id,
      'pro_subscription_activated',
      new.plan_id,
      jsonb_build_object('source', 'verified_subscription')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists track_library_subscription_activation on public.rimbly_subscriptions;
create trigger track_library_subscription_activation
after insert or update on public.rimbly_subscriptions
for each row execute function public.track_library_subscription_activation();

create or replace function public.admin_list_library_documents()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  documents jsonb;
begin
  if not public.has_admin_permission('papers.manage') then
    raise exception 'Past-paper and library document management permission is required'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', document.id,
        'title', document.title,
        'description', document.description,
        'file_name', document.file_name,
        'page_count', document.page_count,
        'status', document.status,
        'created_at', document.created_at,
        'published_at', document.published_at
      )
      order by document.created_at desc
    ),
    '[]'::jsonb
  )
  into documents
  from public.library_documents document;
  return documents;
end;
$$;

create or replace function public.admin_upload_library_document(
  p_title text,
  p_description text,
  p_file_name text,
  p_storage_path text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_page_count integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  document_id uuid;
begin
  if not public.has_admin_permission('papers.manage') then
    raise exception 'Past-paper and library document management permission is required'
      using errcode = '42501';
  end if;

  if length(trim(p_title)) < 1
     or length(trim(p_file_name)) < 1
     or p_storage_path not like auth.uid()::text || '/admin/library/%'
     or p_mime_type <> 'application/pdf'
     or p_file_size_bytes < 1
     or p_file_size_bytes > 31457280
  then
    raise exception 'Invalid library document';
  end if;

  insert into public.library_documents (
    title, description, file_name, storage_path, mime_type,
    file_size_bytes, page_count, status, created_by
  )
  values (
    trim(p_title),
    coalesce(trim(p_description), ''),
    trim(p_file_name),
    p_storage_path,
    p_mime_type,
    p_file_size_bytes,
    p_page_count,
    'draft',
    auth.uid()
  )
  returning id into document_id;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(), 'library_document.uploaded', 'library_document', document_id::text,
    jsonb_build_object('title', trim(p_title), 'file_name', trim(p_file_name))
  );
  return document_id;
end;
$$;

create or replace function public.admin_set_library_document_status(
  p_document_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.has_admin_permission('papers.manage') then
    raise exception 'Past-paper and library document management permission is required'
      using errcode = '42501';
  end if;
  if p_status not in ('published', 'archived') then
    raise exception 'Invalid library document status';
  end if;
  if not exists (
    select 1 from public.library_documents where id = p_document_id
  ) then
    raise exception 'Library document was not found';
  end if;

  update public.library_documents
  set status = p_status,
      published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end
  where id = p_document_id;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(),
    'library_document.' || p_status,
    'library_document',
    p_document_id::text,
    jsonb_build_object('status', p_status)
  );
end;
$$;

create or replace function public.admin_get_library_conversion_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.has_admin_permission('analytics.view') then
    raise exception 'Analytics permission is required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'document_opens', (
      select count(*) from public.library_conversion_events
      where event_name = 'library_document_open'
    ),
    'paywall_views', (
      select count(*) from public.library_conversion_events
      where event_name = 'library_paywall_view'
    ),
    'document_unlocks', (
      select count(*) from public.library_conversion_events
      where event_name = 'library_document_unlocked'
    ),
    'checkout_starts', (
      select count(*) from public.library_conversion_events
      where event_name = 'pro_checkout_started'
    ),
    'subscriptions_activated', (
      select count(*) from public.library_conversion_events
      where event_name = 'pro_subscription_activated'
    )
  );
end;
$$;

revoke all on function public.admin_list_library_documents() from public, anon;
revoke all on function public.admin_upload_library_document(text, text, text, text, text, bigint, integer) from public, anon;
revoke all on function public.admin_set_library_document_status(uuid, text) from public, anon;
revoke all on function public.admin_get_library_conversion_metrics() from public, anon;
grant execute on function public.admin_list_library_documents() to authenticated;
grant execute on function public.admin_upload_library_document(text, text, text, text, text, bigint, integer) to authenticated;
grant execute on function public.admin_set_library_document_status(uuid, text) to authenticated;
grant execute on function public.admin_get_library_conversion_metrics() to authenticated;

drop policy if exists "Library document entitlement required"
  on storage.objects;
create policy "Library document entitlement required"
  on storage.objects as restrictive for select to authenticated
  using (
    bucket_id <> 'library-documents'
    or public.can_access_library_document(name)
  );

drop policy if exists "Users may read entitled library documents"
  on storage.objects;
create policy "Users may read entitled library documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'library-documents'
    and public.can_access_library_document(name)
  );

drop policy if exists "Admins may upload library documents"
  on storage.objects;
create policy "Admins may upload library documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'library-documents'
    and name like auth.uid()::text || '/admin/library/%'
    and public.has_admin_permission('papers.manage')
  );
