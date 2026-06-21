-- Phase E: promote "featured event" from a curated Airtable view to a real
-- boolean field. Admin gets a checkbox per event; the public carousel filters
-- by featured = true AND image_url <> '' AND date < today. Drops the last
-- Airtable read from the public homepage path.
--
-- Manual setup paired with this migration: add a `Featured` checkbox column
-- to the Airtable Events table and tick the rows currently surfaced by view
-- viwz4UVrptnDATP19. Sync (cron or manual POST to /api/admin/sync-airtable)
-- mirrors that flag into events.featured.

alter table events add column if not exists featured boolean default false not null;

-- Partial index for the homepage carousel query: featured AND not deleted.
-- Trivially small footprint since most rows have featured = false.
create index if not exists events_featured_idx on events (featured)
  where featured = true and airtable_deleted_at is null and deleted_at is null;
