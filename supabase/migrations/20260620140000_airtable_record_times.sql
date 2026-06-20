-- Phase 2 hotfix: carry Airtable record createdTime into Supabase.
--
-- Previously the `users.created` / `events.created` fields surfaced by the
-- new readers were sourced from the Supabase row's created_at, which is
-- "when the Phase 1 sync first inserted this row" — i.e. today. Worse, the
-- backfill we shipped in 20260620130000 set `first_activated_at = created_at`
-- for active users, which means every currently-active user shows
-- first_activated_at = today regardless of when they actually got approved.
--
-- The closest signal we have to "when did this user (or event) originally
-- exist" is Airtable's record createdTime. Mirror that into a dedicated
-- column so reads can return real timestamps and the activation backfill
-- can self-correct.

alter table users add column if not exists airtable_created_at timestamptz;
alter table events add column if not exists airtable_created_at timestamptz;
