-- Migrate user-submitted ratings from two-state (up/down) to three-state
-- (going / cant_make_it / not_a_fit).
-- Mapping: 'up' → 'cant_make_it', 'down' → 'not_a_fit'

update matches set rating = 'cant_make_it' where rating = 'up';
update matches set rating = 'not_a_fit'   where rating = 'down';

-- Drop old constraint and replace with three-value version.
alter table matches drop constraint if exists matches_rating_check;

alter table matches
  add constraint matches_rating_check
  check (rating is null or rating in ('going', 'cant_make_it', 'not_a_fit'));
