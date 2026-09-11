-- Find a member by name when sharing events, instead of having to know their
-- email address.
--
-- Two columns, both about privacy rather than capability.
--
-- users.discoverable — opt-out of appearing in another member's name search.
-- Defaults true so the feature works for everyone on day one; a member running
-- a confidential search can switch it off and drop out of results without
-- losing any share they already has set up.
alter table users add column if not exists discoverable boolean not null default true;

-- Partial index matching the search predicate exactly (active, discoverable,
-- not tombstoned) so the typeahead never scans the full table.
create index if not exists users_discoverable_idx on users (id)
  where discoverable = true and active = true
    and airtable_deleted_at is null and deleted_at is null;

-- event_share_contacts.added_via — how this contact got here.
--
-- This is what stops the name picker becoming an email-harvesting tool: search
-- a name, add them, then read their address off your own contact list. For a
-- contact added by picking a member we must never echo the email back, because
-- the owner never knew it. For one added by typing an address we show it,
-- because they typed it.
--
-- Email remains the join key; this column only governs display.
alter table event_share_contacts
  add column if not exists added_via text not null default 'email';

alter table event_share_contacts
  drop constraint if exists event_share_contacts_added_via_check;
alter table event_share_contacts
  add constraint event_share_contacts_added_via_check
  check (added_via in ('email', 'member'));
