-- Phase 1 of the Airtable -> Supabase migration: real users and events tables.
--
-- Today lib/sync.ts mirrors Airtable into users_cache / events_cache, which
-- nothing reads at runtime. These new tables are the future source-of-truth
-- for the app, replacing every getUserByEmail / getActiveUsers / getFutureEvents
-- call that today reads Airtable directly.
--
-- Phase 1 is purely additive: the sync writes to both the legacy cache tables
-- AND these new tables. No reader is wired up yet. Phase 2 will swap reads,
-- Phase 3 will swap writes, Phase 7 will drop the legacy caches.

-- ---------------------------------------------------------------------------
-- users — full user record. Replaces users_cache as the source-of-truth shape.
-- ---------------------------------------------------------------------------
create table if not exists users (
  id text primary key,                       -- preserved from Airtable rec ID
  email text not null,
  name text default '',
  first_name text default '',
  fn text default '',                        -- Function (SQL-reserved keyword avoided)
  seniority text default '',
  grade text check (grade is null or grade in ('A', 'Polish', 'B', 'C')),
  company_size text default '',
  interest text default '',
  employment text default '',
  location text default '',
  lat numeric,
  lng numeric,
  active boolean default false not null,     -- gated by admin approval
  status text default '',                    -- raw Airtable Active value
  frequency text default '',
  linkedin text default '',
  learn text default '',
  -- Two distinct soft-delete signals:
  --   airtable_deleted_at: row disappeared from Airtable upstream (sync hygiene)
  --   deleted_at:          admin intentionally removed the user (app action)
  -- Matching / login should skip rows where either is non-null.
  airtable_deleted_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Auth lookup (case-insensitive). Not unique because soft-deleted rows may
-- share an email with a new active row; application enforces single-active.
create index if not exists users_email_lower_idx on users (lower(email));

-- Matching-eligible scan: WHERE active = true AND deleted_at IS NULL.
-- Partial index keeps it tight; covers the hot loop.
create index if not exists users_active_idx on users (id)
  where active = true and airtable_deleted_at is null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- events — full event record. Replaces events_cache as the source-of-truth shape.
-- ---------------------------------------------------------------------------
create table if not exists events (
  id text primary key,                       -- preserved from Airtable rec ID
  name text not null default '',
  type text default '',
  date date,                                 -- real DATE type; empty Airtable cell -> NULL
  location text default '',
  description text default '',
  link text default '',
  audience text[] default '{}'::text[],
  lat numeric,
  lng numeric,
  submitter_email text default '',
  source text default '',                    -- 'Email' | 'Dashboard' | ...
  image_url text default '',                 -- empty during Phase 1 (still proxied via /api/event-image)
  -- Denormalized array of user.id values. Matches Airtable's Host[] linked-record
  -- shape directly. "events Andy hosts" becomes WHERE 'userId' = ANY(host_ids),
  -- which the GIN index below makes fast.
  host_ids text[] default '{}'::text[],
  -- Approval gate. Defaults true so existing data behaves unchanged on backfill.
  -- Phase 4 admin UI flips this for new inbound-email events; in-app submissions
  -- continue defaulting to approved.
  approved boolean default true not null,
  airtable_deleted_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists events_date_idx on events (date);

-- Compound index for the matching scan:
--   WHERE approved = true AND date >= today AND deleted_at IS NULL.
create index if not exists events_approved_date_idx on events (approved, date)
  where airtable_deleted_at is null and deleted_at is null;

-- "events hosted by user X" — GIN supports `WHERE 'userId' = ANY(host_ids)`.
create index if not exists events_host_ids_gin_idx on events using gin (host_ids);

-- ---------------------------------------------------------------------------
-- updated_at trigger — fires on every UPDATE so writers don't have to remember.
-- Shared function (created idempotently) since both tables use the same shape.
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at
  before update on users
  for each row execute function set_updated_at();

drop trigger if exists events_set_updated_at on events;
create trigger events_set_updated_at
  before update on events
  for each row execute function set_updated_at();
