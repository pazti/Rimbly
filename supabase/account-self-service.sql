-- Apply after quiz-battles.sql, ambassador-program.sql, and learning-rewards.sql.
-- Keep shared quiz and payout history while removing the account that created it.

begin;

alter table public.contributions
  drop constraint if exists contributions_user_id_fkey,
  add constraint contributions_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.quiz_sets
  alter column created_by drop not null;

alter table public.quiz_sets
  drop constraint if exists quiz_sets_created_by_fkey,
  add constraint quiz_sets_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table public.ambassador_payouts
  alter column paid_by drop not null;

alter table public.ambassador_payouts
  drop constraint if exists ambassador_payouts_paid_by_fkey,
  add constraint ambassador_payouts_paid_by_fkey
    foreign key (paid_by) references auth.users(id) on delete set null;

commit;
