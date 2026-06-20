-- Phase 2 prep: close two gaps before we swap readers from Airtable to Supabase.
--
-- 1. `is_partner boolean` — the partner gate. Airtable's Users.Status field is
--    distinct from Active and only used by getPartnerUserByEmail to filter
--    `{Status} = 'Partner'`. Boolean column derived during sync.
--
-- 2. `first_activated_at timestamptz` — the "Pending vs Disabled" derivation
--    layer on top of the simplified active boolean. Pure-boolean active means
--    we lose the raw Pending / Active / Disabled distinction we got from the
--    text field. A timestamp recovers it without reintroducing a stringly-typed
--    enum:
--      active = true                                 -> active
--      active = false AND first_activated_at IS NULL -> pending review
--      active = false AND first_activated_at IS NOT NULL -> disabled
--
--    Stamped automatically by the trigger below the first time active flips
--    true; preserved across subsequent syncs because the sync's upsert payload
--    deliberately omits this column (ON CONFLICT DO UPDATE SET only touches
--    columns present in EXCLUDED).

alter table users add column if not exists is_partner boolean default false not null;
alter table users add column if not exists first_activated_at timestamptz;

-- Partial index for partner-only filters.
create index if not exists users_is_partner_idx on users (id)
  where is_partner = true and airtable_deleted_at is null and deleted_at is null;

create or replace function set_first_activated_at() returns trigger as $$
begin
  if new.active = true and new.first_activated_at is null then
    new.first_activated_at = now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_set_first_activated_at on users;
create trigger users_set_first_activated_at
  before insert or update on users
  for each row execute function set_first_activated_at();

-- Best-effort backfill: for users already active at this migration, stamp
-- first_activated_at = the Supabase row's created_at (closest signal we have
-- to "when did they get approved"). Good enough for the Pending vs Disabled
-- derivation going forward.
update users
   set first_activated_at = created_at
 where active = true
   and first_activated_at is null
   and airtable_deleted_at is null
   and deleted_at is null;
