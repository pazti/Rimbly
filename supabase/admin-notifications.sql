-- Apply after admin-management.sql. Adds in-app admin invitations and
-- administrator-authored notifications for all registered accounts.
begin;

create or replace function public.notify_admin_invitation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  role_name text;
begin
  if new.status <> 'invited' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'invited' and old.role_id = new.role_id then
      return new;
    end if;
  end if;

  select role_record.name into role_name
  from public.admin_roles role_record
  where role_record.id = new.role_id;

  insert into public.notifications (user_id, title, body, type)
  values (
    new.user_id,
    'Admin invitation',
    format(
      'You’ve been invited to join the Rimbly admin team as %s. Open Notifications in Rimbly to accept.',
      coalesce(role_name, new.role_id)
    ),
    'admin_invitation'
  );
  return new;
end;
$$;

drop trigger if exists notify_admin_invitation on public.admin_memberships;
create trigger notify_admin_invitation
after insert or update on public.admin_memberships
for each row execute function public.notify_admin_invitation();

create or replace function public.admin_send_broadcast_notification(
  p_title text,
  p_body text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  recipient_count integer;
  clean_title text := nullif(trim(p_title), '');
  clean_body text := nullif(trim(p_body), '');
begin
  if not public.has_admin_permission('students.manage') then
    raise exception 'Student management permission is required' using errcode = '42501';
  end if;
  if clean_title is null or char_length(clean_title) > 100 then
    raise exception 'Notification title must be between 1 and 100 characters';
  end if;
  if clean_body is null or char_length(clean_body) > 1000 then
    raise exception 'Notification message must be between 1 and 1000 characters';
  end if;

  insert into public.notifications (user_id, title, body, type)
  select account.id, clean_title, clean_body, 'admin_broadcast'
  from auth.users account;

  get diagnostics recipient_count = row_count;
  if recipient_count = 0 then
    raise exception 'There are no registered users to notify';
  end if;

  insert into public.admin_audit_logs (actor_id, action, resource_type, details)
  values (
    auth.uid(),
    'notification.broadcast',
    'notification',
    jsonb_build_object('title', clean_title, 'recipient_count', recipient_count)
  );

  return recipient_count;
end;
$$;

revoke all on function public.notify_admin_invitation() from public, anon, authenticated;
revoke all on function public.admin_send_broadcast_notification(text, text) from public, anon;
grant execute on function public.admin_send_broadcast_notification(text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
