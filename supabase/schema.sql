create extension if not exists pgcrypto;

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  phone text not null,
  university text not null,
  level text not null,
  subjects text,
  created_at timestamptz not null default now()
);

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  category text not null,
  suggestion text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.contributions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  university text not null,
  course_code text not null,
  course_title text not null,
  exam_year integer not null,
  question_file_name text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_waitlist_email on public.waitlist (email);
create index if not exists idx_suggestions_email on public.suggestions (email);
create index if not exists idx_contributions_email on public.contributions (email);

alter table public.waitlist enable row level security;
alter table public.suggestions enable row level security;
alter table public.contributions enable row level security;

create policy if not exists "allow_public_insert_waitlist"
on public.waitlist
for insert
with check (true);

create policy if not exists "allow_authenticated_select_waitlist"
on public.waitlist
for select
using (auth.role() = 'authenticated');

create policy if not exists "allow_public_insert_suggestions"
on public.suggestions
for insert
with check (true);

create policy if not exists "allow_authenticated_select_suggestions"
on public.suggestions
for select
using (auth.role() = 'authenticated');

create policy if not exists "allow_public_insert_contributions"
on public.contributions
for insert
with check (true);

create policy if not exists "allow_authenticated_select_contributions"
on public.contributions
for select
using (auth.role() = 'authenticated');
