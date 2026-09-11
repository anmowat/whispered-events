-- "Share the events you're attending" — a member nominates contacts by email,
-- and those contacts see the events the member has rated 'interested'.
--
-- Keyed by EMAIL, not by user id, and deliberately so: a member can share with
-- someone who hasn't joined yet. Resolving the email to a member at read time
-- means the share activates by itself the moment that person signs up, with no
-- backfill job to run and no stale id to go wrong. (contributions solves the
-- same problem with a nullable airtable_user_id plus a linking pass at
-- approval; this is the same idea with one less moving part.)
--
-- Note users.email is NOT unique — users_email_lower_idx is non-unique because
-- soft-deleted rows may share an address — so every read that resolves an
-- email to a member must filter to the active, non-deleted row.
create table if not exists event_share_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,        -- the member doing the sharing (users.id)
  contact_email text not null,        -- lowercased; may not be a member yet
  invited_at timestamptz,             -- when the non-member invite was sent
  deleted_at timestamptz,             -- soft delete, so re-adding later is clean
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live row per (owner, contact). Scoped to deleted_at is null so removing
-- a contact and adding them back doesn't collide with the tombstone.
create unique index if not exists event_share_contacts_owner_email_idx
  on event_share_contacts (owner_user_id, lower(contact_email))
  where deleted_at is null;

-- "who is sharing with me" — the reverse lookup, by email.
create index if not exists event_share_contacts_email_idx
  on event_share_contacts (lower(contact_email))
  where deleted_at is null;

create index if not exists event_share_contacts_owner_idx
  on event_share_contacts (owner_user_id)
  where deleted_at is null;

-- Shared updated_at trigger, created in 20260620120000_users_events_tables.sql.
drop trigger if exists event_share_contacts_set_updated_at on event_share_contacts;
create trigger event_share_contacts_set_updated_at
  before update on event_share_contacts
  for each row execute function set_updated_at();

-- Default-deny: the app reaches Supabase only via the service role key, which
-- bypasses RLS. Enabling it with no policies denies every other caller.
-- Same one-liner as 20260710000000_enable_rls_love_entries.sql.
alter table public.event_share_contacts enable row level security;

-- Per-user counts for the admin member list, which polls every 10s and so
-- cannot afford a query per row. GROUP BY happens in the database, one row per
-- user, so PostgREST's max_rows can't silently truncate it. Mirrors
-- match_counts_by_user in 20260729000000_match_count_aggregates_and_indexes.sql.
--
-- shared_with: contacts this member shares their events WITH (by owner id).
-- shared_from: members sharing their events with this one (matched on email).
create or replace function contact_counts_by_user(p_user_ids text[])
returns table(user_id text, shared_with bigint, shared_from bigint)
language sql
stable
security definer
as $$
  with targets as (
    select u.id, lower(u.email) as email
    from users u
    where u.id = any(p_user_ids)
  ),
  with_counts as (
    select c.owner_user_id as id, count(*) as n
    from event_share_contacts c
    where c.owner_user_id = any(p_user_ids)
      and c.deleted_at is null
    group by c.owner_user_id
  ),
  from_counts as (
    select t.id, count(*) as n
    from targets t
    join event_share_contacts c
      on lower(c.contact_email) = t.email
     and c.deleted_at is null
    group by t.id
  )
  select t.id,
         coalesce(w.n, 0) as shared_with,
         coalesce(f.n, 0) as shared_from
  from targets t
  left join with_counts w on w.id = t.id
  left join from_counts f on f.id = t.id;
$$;
