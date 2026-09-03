-- A / B / C quality grade for events, mirroring the member grade concept but
-- with its own three-tier scale (no "Polish" — polish describes a person's
-- readiness and has no meaning for an event).
--
-- A is the neutral default: every existing event backfills to 'A', whose
-- multiplier is 1.0, so no existing match score moves. B and C are pure
-- decrements applied in lib/matching.ts (EVENT_GRADE_MULTIPLIER).
alter table events add column if not exists grade text not null default 'A';

alter table events drop constraint if exists events_grade_check;
alter table events add constraint events_grade_check check (grade in ('A', 'B', 'C'));
