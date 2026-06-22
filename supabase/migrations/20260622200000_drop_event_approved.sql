-- Retire the legacy events.approved boolean. Replaced by the status text
-- column (20260622180000_event_status.sql); every reader filters on
-- status = 'Live' and every writer sets status only.
--
-- Run after one production cycle on the status column so any in-flight
-- code path that still references `approved` would have surfaced.
--
-- The companion index events_approved_date_idx is now redundant —
-- events_status_date_idx (partial on status='Live') covers the same
-- matching-loop hot path.

drop index if exists public.events_approved_date_idx;

alter table public.events
  drop column if exists approved;
