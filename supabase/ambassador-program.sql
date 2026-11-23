-- Run after admin-foundation.sql, admin-management.sql, activation-measurement.sql,
-- and quiz-battles.sql.
-- Adds agreement-gated ambassador links and rewards on first reviewed-quiz activation.
begin;

create table if not exists public.ambassador_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  invite_code text not null unique,
  agreed_at timestamptz not null default now(),
  terms_version text not null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (invite_code ~ '^[A-F0-9]{10}$')
);

create table if not exists public.ambassador_referrals (
  referred_user_id uuid primary key references auth.users(id) on delete cascade,
  ambassador_user_id uuid not null references public.ambassador_profiles(user_id) on delete cascade,
  invite_code text not null,
  signed_up_at timestamptz not null default now(),
  activated_at timestamptz,
  reward_amount integer not null default 250 check (reward_amount = 250),
  status text not null default 'pending' check (status in ('pending', 'earned', 'void')),
  check (referred_user_id <> ambassador_user_id),
  check ((status = 'pending' and activated_at is null) or
         (status = 'earned' and activated_at is not null) or
         (status = 'void' and activated_at is null))
);

create index if not exists ambassador_referrals_ambassador_signed_up_idx
  on public.ambassador_referrals (ambassador_user_id, signed_up_at desc);
create index if not exists ambassador_referrals_activated_idx
  on public.ambassador_referrals (ambassador_user_id, activated_at desc)
  where status = 'earned';

alter table public.ambassador_profiles enable row level security;
alter table public.ambassador_referrals enable row level security;
revoke all on public.ambassador_profiles, public.ambassador_referrals
  from public, anon, authenticated;

create or replace function public.become_ambassador(p_terms_version text)
returns table (
  invite_code text,
  status text,
  agreed_at timestamptz,
  total_signups bigint,
  total_activated bigint,
  total_earned bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  generated_code text;
  agreement_time timestamptz;
  current_status text;
  signups bigint;
  activations bigint;
  earnings bigint;
begin
  if auth.uid() is null or public.current_user_is_suspended() then
    raise exception 'An active signed-in account is required' using errcode = '42501';
  end if;
  if p_terms_version is distinct from '2026-11-v1' then
    raise exception 'The ambassador terms have changed. Review and agree to the latest terms.';
  end if;

  select ambassador_profiles.invite_code, ambassador_profiles.agreed_at,
         ambassador_profiles.status
    into generated_code, agreement_time, current_status
  from public.ambassador_profiles
  where ambassador_profiles.user_id = auth.uid();

  if not found then
    loop
      generated_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
      begin
        insert into public.ambassador_profiles (user_id, invite_code, terms_version)
        values (auth.uid(), generated_code, p_terms_version)
        returning ambassador_profiles.invite_code, ambassador_profiles.agreed_at,
                  ambassador_profiles.status
          into generated_code, agreement_time, current_status;
        exit;
      exception when unique_violation then
        if exists (
          select 1 from public.ambassador_profiles
          where ambassador_profiles.user_id = auth.uid()
        ) then
          select ambassador_profiles.invite_code, ambassador_profiles.agreed_at,
                 ambassador_profiles.status
            into generated_code, agreement_time, current_status
          from public.ambassador_profiles
          where ambassador_profiles.user_id = auth.uid();
          exit;
        end if;
      end;
    end loop;
  end if;

  select count(*)::bigint,
         count(*) filter (where referral.status = 'earned')::bigint,
         coalesce(sum(referral.reward_amount) filter (where referral.status = 'earned'), 0)::bigint
    into signups, activations, earnings
  from public.ambassador_referrals referral
  where referral.ambassador_user_id = auth.uid();

  return query select generated_code, current_status, agreement_time,
                      signups, activations, earnings;
end;
$$;

create or replace function public.get_ambassador_dashboard()
returns table (
  invite_code text,
  status text,
  agreed_at timestamptz,
  total_signups bigint,
  total_activated bigint,
  total_earned bigint
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
    select ambassador.invite_code, ambassador.status, ambassador.agreed_at,
      count(referral.referred_user_id)::bigint,
      count(referral.referred_user_id) filter (where referral.status = 'earned')::bigint,
      coalesce(sum(referral.reward_amount) filter (where referral.status = 'earned'), 0)::bigint
    from public.ambassador_profiles ambassador
    left join public.ambassador_referrals referral
      on referral.ambassador_user_id = ambassador.user_id
    where ambassador.user_id = auth.uid()
    group by ambassador.user_id;
end;
$$;

create or replace function public.capture_ambassador_signup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  referred_code text := upper(trim(coalesce(new.raw_user_meta_data ->> 'rimbly_referral_code', '')));
begin
  if referred_code = '' or length(referred_code) > 10 then
    return new;
  end if;

  insert into public.ambassador_referrals (
    referred_user_id, ambassador_user_id, invite_code
  )
  select new.id, ambassador.user_id, ambassador.invite_code
  from public.ambassador_profiles ambassador
  where ambassador.invite_code = referred_code
    and ambassador.status = 'active'
    and ambassador.user_id <> new.id
  on conflict (referred_user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists capture_ambassador_signup on auth.users;
create trigger capture_ambassador_signup
after insert on auth.users
for each row execute function public.capture_ambassador_signup();

insert into public.ambassador_referrals (
  referred_user_id, ambassador_user_id, invite_code, signed_up_at
)
select account.id, ambassador.user_id, ambassador.invite_code, account.created_at
from auth.users account
join public.ambassador_profiles ambassador
  on ambassador.invite_code = upper(trim(coalesce(
    account.raw_user_meta_data ->> 'rimbly_referral_code', ''
  )))
where ambassador.status = 'active'
  and ambassador.user_id <> account.id
  and account.created_at >= ambassador.agreed_at
on conflict (referred_user_id) do nothing;

create or replace function public.reward_ambassador_on_activation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.ambassador_referrals referral
  set status = 'earned',
      activated_at = coalesce(referral.activated_at, new.activated_at)
  where referral.referred_user_id = new.user_id
    and referral.status = 'pending';
  return new;
end;
$$;

drop trigger if exists reward_ambassador_on_activation on public.rimbly_activation_events;
create trigger reward_ambassador_on_activation
after insert or update of activated_at on public.rimbly_activation_events
for each row execute function public.reward_ambassador_on_activation();

create or replace function public.admin_list_ambassadors()
returns table (
  user_id uuid,
  full_name text,
  email text,
  invite_code text,
  status text,
  agreed_at timestamptz,
  total_signups bigint,
  total_activated bigint,
  total_earned bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if public.current_user_is_suspended() or not exists (
    select 1 from public.admin_memberships membership
    where membership.user_id = auth.uid()
      and membership.role_id = 'super_admin'
      and membership.status = 'active'
  ) then
    raise exception 'Super Admin access is required' using errcode = '42501';
  end if;

  return query
    select ambassador.user_id,
      coalesce(profile.full_name, 'Student'),
      coalesce(account.email, ''),
      ambassador.invite_code,
      ambassador.status,
      ambassador.agreed_at,
      count(referral.referred_user_id)::bigint,
      count(referral.referred_user_id) filter (where referral.status = 'earned')::bigint,
      coalesce(sum(referral.reward_amount) filter (where referral.status = 'earned'), 0)::bigint
    from public.ambassador_profiles ambassador
    left join public.profiles profile on profile.id = ambassador.user_id
    left join auth.users account on account.id = ambassador.user_id
    left join public.ambassador_referrals referral
      on referral.ambassador_user_id = ambassador.user_id
    group by ambassador.user_id, profile.full_name, account.email
    order by ambassador.agreed_at desc;
end;
$$;

create or replace function public.admin_set_ambassador_status(
  p_user_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous_status text;
begin
  if public.current_user_is_suspended() or not exists (
    select 1 from public.admin_memberships membership
    where membership.user_id = auth.uid()
      and membership.role_id = 'super_admin'
      and membership.status = 'active'
  ) then
    raise exception 'Super Admin access is required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active', 'paused', 'removed') then
    raise exception 'Choose a valid ambassador status';
  end if;

  select ambassador.status into previous_status
  from public.ambassador_profiles ambassador
  where ambassador.user_id = p_user_id
  for update;
  if not found then
    raise exception 'Ambassador account not found';
  end if;

  update public.ambassador_profiles
  set status = p_status, updated_at = now()
  where user_id = p_user_id;

  if p_status = 'removed' then
    update public.ambassador_referrals
    set status = 'void'
    where ambassador_user_id = p_user_id
      and status = 'pending';
  end if;

  insert into public.admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (
    auth.uid(),
    'ambassador.status_changed',
    'ambassador',
    p_user_id::text,
    jsonb_build_object('previous_status', previous_status, 'status', p_status)
  );
end;
$$;

revoke all on function public.become_ambassador(text) from public, anon;
revoke all on function public.get_ambassador_dashboard() from public, anon;
revoke all on function public.capture_ambassador_signup() from public, anon, authenticated;
revoke all on function public.reward_ambassador_on_activation() from public, anon, authenticated;
revoke all on function public.admin_list_ambassadors() from public, anon;
revoke all on function public.admin_set_ambassador_status(uuid, text) from public, anon;

grant execute on function public.become_ambassador(text) to authenticated;
grant execute on function public.get_ambassador_dashboard() to authenticated;
grant execute on function public.admin_list_ambassadors() to authenticated;
grant execute on function public.admin_set_ambassador_status(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
