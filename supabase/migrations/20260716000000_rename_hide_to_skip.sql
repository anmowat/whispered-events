-- Rename the 'hide' rating value to 'skip' everywhere.
-- 1. Drop the existing check constraint, update rows, re-add constraint.

alter table public.matches drop constraint if exists matches_rating_check;

update public.matches set rating = 'skip' where rating = 'hide';

alter table public.matches
  add constraint matches_rating_check
  check (rating is null or rating in ('interested', 'skip', 'not_a_fit'));
