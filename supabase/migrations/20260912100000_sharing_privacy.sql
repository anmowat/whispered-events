-- Privacy controls for event sharing.
--
-- Replaces the single boolean users.discoverable with two settings that answer
-- two genuinely different questions:
--
--   findable          how other people can reach YOU
--   share_visibility  who can see YOUR events
--
-- They are independent on purpose: a member can broadcast their events to
-- everyone while receiving nothing from anybody.

-- ---------------------------------------------------------------------------
-- findable: 'email_name' | 'email' | 'none'
--
--   email_name  appears in name search; can receive shares          (default)
--   email       not in name search; can still receive shares by address
--   none        opted out of receiving entirely. Other members can still add
--               the address and the row is still written - we don't fail their
--               action - but the recipient sees nothing in View Events and
--               gets no digest line. Switching back reveals whatever
--               accumulated in the meantime.
-- ---------------------------------------------------------------------------
alter table users add column if not exists findable text not null default 'email_name';

alter table users drop constraint if exists users_findable_check;
alter table users add constraint users_findable_check
  check (findable in ('email_name', 'email', 'none'));

-- Carry the old boolean over. discoverable = false meant "keep me out of name
-- search", which is exactly 'email' - it never stopped shares by address.
-- Idempotent: re-running sets the same rows to the same value.
update users set findable = 'email' where discoverable is false;

-- ---------------------------------------------------------------------------
-- share_visibility: 'contacts' | 'everyone'
--
--   contacts  only people this member has added             (default, today)
--   everyone  any member can find them in Search Users and follow their events
-- ---------------------------------------------------------------------------
alter table users add column if not exists share_visibility text not null default 'contacts';

alter table users drop constraint if exists users_share_visibility_check;
alter table users add constraint users_share_visibility_check
  check (share_visibility in ('contacts', 'everyone'));

-- Partial indexes matching the two search predicates exactly, so neither
-- typeahead scans the full table. Replaces users_discoverable_idx, whose
-- predicate was a boolean comparison on the superseded column.
drop index if exists users_discoverable_idx;

create index if not exists users_findable_name_idx on users (id)
  where findable = 'email_name' and active = true
    and airtable_deleted_at is null and deleted_at is null;

create index if not exists users_share_everyone_idx on users (id)
  where share_visibility = 'everyone' and active = true
    and airtable_deleted_at is null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- added_via gains 'follow': a row created by the CONTACT rather than the owner,
-- when the owner has opted into share_visibility = 'everyone'.
--
-- The row alone is not authority to read: switching back to 'contacts' must
-- revoke every follower at once, so the read path re-checks the owner's
-- current share_visibility instead of trusting that a row exists.
-- ---------------------------------------------------------------------------
alter table event_share_contacts drop constraint if exists event_share_contacts_added_via_check;
alter table event_share_contacts add constraint event_share_contacts_added_via_check
  check (added_via in ('email', 'member', 'follow'));

-- NOTE: users.discoverable is now superseded and read by nothing. It is left
-- in place deliberately so this migration can be applied before the deploy
-- without breaking in-flight requests. Drop it in a follow-up once the new
-- code is live:
--   alter table users drop column if exists discoverable;
