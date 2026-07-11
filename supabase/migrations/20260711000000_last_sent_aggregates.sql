-- Fast server-side aggregates to replace full-table JS dedup in
-- getLastSeenByUserId / getLastDigestSentByUserId / getLastBlastSentByUserId.
-- Previously those functions fetched every row (limit 100k) and deduped in JS;
-- these functions return one row per user from the DB, cutting wire transfer
-- from O(all rows) to O(distinct users).

create or replace function get_last_session_by_user()
returns table(user_id uuid, last_seen_at timestamptz)
language sql stable security definer
as $$
  select user_id, max(last_seen_at) as last_seen_at
  from sessions
  where user_id is not null
  group by user_id;
$$;

create or replace function get_last_digest_by_user()
returns table(user_id uuid, sent_at timestamptz)
language sql stable security definer
as $$
  select user_id, max(sent_at) as sent_at
  from digest_sends
  where kind <> 'blast' and user_id is not null
  group by user_id;
$$;

create or replace function get_last_blast_by_user()
returns table(user_id uuid, sent_at timestamptz)
language sql stable security definer
as $$
  select user_id, max(sent_at) as sent_at
  from digest_sends
  where kind = 'blast' and user_id is not null
  group by user_id;
$$;
