-- User-submitted thumbs-up / thumbs-down rating on a (user, event) match.
-- Stored on the matches row alongside the existing score components.
-- Notification to the team is fired from the API route, not the DB.

alter table matches
  add column if not exists rating text,
  add column if not exists rating_reason text,
  add column if not exists rated_at timestamptz;

-- Only 'up' / 'down' / null are valid. Surface bad writes loudly rather than
-- silently degrading downstream aggregations.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'matches_rating_check'
  ) then
    alter table matches
      add constraint matches_rating_check
      check (rating is null or rating in ('up', 'down'));
  end if;
end $$;

-- Drives the admin users-list "Rating" column (counts up/down per user).
create index if not exists matches_user_rating_idx on matches (user_id, rating)
  where rating is not null;
