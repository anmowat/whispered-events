-- Event lifecycle status, mirroring the user lifecycle picklist added in
-- Phase H. Three states:
--
--   Pending     - new events land here. Submitter still gets the
--                 confirmation email at submit time, but the event does NOT
--                 appear in any user's dashboard or get scored against
--                 users until an admin approves it.
--   Live        - admin reviewed + approved. Matching loop scores the event
--                 against eligible users; it shows up in dashboards and
--                 digest emails.
--   Deactivated - was Live, admin pulled it. Drops out of getFutureEvents
--                 and friends so it disappears from user dashboards on the
--                 next refresh. Existing matches table rows are left alone
--                 (they'd just be orphaned reads).
--
-- The legacy `approved boolean default true` column stays for now as a
-- soft-deprecated compat shim. Future writers target `status` only; readers
-- filter on `status = 'Live'`. A follow-up migration can drop `approved`
-- once we're confident nothing reads it.

alter table public.events
  add column if not exists status text not null default 'Pending';

-- Backfill: every existing row was created with the auto-approve default,
-- so collapse approved=true -> Live. Anything explicitly approved=false
-- (none today, but defensive) becomes Deactivated rather than Pending so
-- the admin doesn't see a flood of "to approve" rows that were previously
-- hidden.
update public.events
   set status = case
     when approved is true then 'Live'
     else 'Deactivated'
   end
 where status = 'Pending';

-- Narrow index for the matching-loop read path (status = 'Live' AND date >=
-- today). The pre-existing events_approved_date_idx becomes redundant once
-- the readers switch over; leave it in place for now and clean up in the
-- same follow-up that drops `approved`.
create index if not exists events_status_date_idx
  on public.events (status, date)
  where status = 'Live';
