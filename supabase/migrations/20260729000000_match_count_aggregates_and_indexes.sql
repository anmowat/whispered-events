-- Server-side match-count aggregates + indexes for the hot admin paths.
--
-- Three functions in lib/supabase.ts aggregated `matches` badly, two of them
-- on a 10-second admin poll:
--   getMatchCountsByUserId    — one COUNT query PER USER
--   getExistingMatchHashes    — one query PER EVENT
--   getMatchCountsByEventId   — fetched up to 500k rows to count them in JS
--
-- The per-row fan-outs were chosen deliberately to dodge PostgREST's max_rows
-- truncation (which also means the 500k .limit() was never actually safe).
-- Doing the GROUP BY in the database satisfies both concerns at once: one
-- round-trip, and the result is one row per key so max_rows can't bite.

-- event_id -> count of matches at or above min_pct, restricted to the given
-- event ids. Mirrors getMatchCountsByEventId.
create or replace function match_counts_by_event(
  p_event_ids text[],
  p_min_pct integer
)
returns table(event_id text, match_count bigint)
language sql stable security definer
as $$
  select m.event_id, count(*) as match_count
  from matches m
  where m.event_id = any(p_event_ids)
    and m.match_percent >= p_min_pct
  group by m.event_id;
$$;

-- user_id -> count of matches at or above min_pct, restricted to the given
-- user ids and event ids. Mirrors getMatchCountsByUserId.
create or replace function match_counts_by_user(
  p_event_ids text[],
  p_user_ids text[],
  p_min_pct integer
)
returns table(user_id text, match_count bigint)
language sql stable security definer
as $$
  select m.user_id, count(*) as match_count
  from matches m
  where m.user_id = any(p_user_ids)
    and m.event_id = any(p_event_ids)
    and m.match_percent >= p_min_pct
  group by m.user_id;
$$;

-- Indexes on hot filter columns that had no usable index.

-- matches(user_id): the existing (user_id, rating) index is partial on
-- `rating is not null`, which excludes most rows; user_id is only the second
-- column of matches_inputs_hash_idx so it can't lead there either.
create index if not exists matches_user_id_idx
  on matches (user_id);

-- Supports both aggregates above (leading event_id, then the range filter).
create index if not exists matches_event_id_match_percent_idx
  on matches (event_id, match_percent);

-- notified_at drives getUnnotifiedMatchesForUser, resetNotifiedAtForEvent and
-- the homepage all-time match counter.
create index if not exists matches_notified_at_idx
  on matches (notified_at);

-- Scanned on every admin dashboard poll by getContributionTotalsByUserId.
create index if not exists contributions_airtable_user_id_idx
  on contributions (airtable_user_id);

-- The get_last_*_by_user aggregates group over this table on every poll.
create index if not exists digest_sends_user_kind_sent_idx
  on digest_sends (user_id, kind, sent_at desc);

-- The toApprove / deactivated / all admin buckets fall outside the
-- `active = true` partial index and currently seq-scan users.
create index if not exists users_status_idx
  on users (status);
