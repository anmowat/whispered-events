-- Rename rating values: going → interested, cant_make_it → hide.
-- Drop old check constraint, backfill rows, add new constraint.

alter table public.matches drop constraint if exists matches_rating_check;

update public.matches set rating = 'interested' where rating = 'going';
update public.matches set rating = 'hide'       where rating = 'cant_make_it';

alter table public.matches
  add constraint matches_rating_check
  check (rating is null or rating in ('interested', 'hide', 'not_a_fit'));
