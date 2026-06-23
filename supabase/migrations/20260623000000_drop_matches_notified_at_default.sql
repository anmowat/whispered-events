-- matches.notified_at had a `default now()` set via the Supabase dashboard,
-- which made every new match row auto-stamp at insert time. The daily cron
-- (lib/digest.ts:runDailyArriveDigests) calls getUnnotifiedMatchesForUser
-- which filters `notified_at IS NULL` — so it always found zero rows and
-- no digests went out. Several days of users (Paul Mander among them) got
-- matched to fresh events but never received their "As they arrive"
-- digest.
--
-- The fix is the column's default. logMatch in lib/supabase.ts has never
-- included notified_at in its upsert payload, exactly so the column stays
-- NULL on insert and preserved on update. That contract only holds when
-- the schema default is also NULL.
--
-- The data repair (NULLing notified_at for matches that have no
-- corresponding digest_sends row) was run ad-hoc in production; not
-- included here because we don't want it to re-execute on every
-- environment. If you're seeding a fresh environment, the repair is a
-- no-op because the matches table starts empty.

alter table public.matches
  alter column notified_at drop default;
