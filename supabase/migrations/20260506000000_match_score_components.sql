-- Multiplicative matching algorithm: extend `matches` with score components,
-- a stored display percent, an inputs hash for dedupe, and a skipped reason.

alter table matches
  add column if not exists location_score numeric,
  add column if not exists audience_score numeric,
  add column if not exists quality_score numeric,
  add column if not exists preference_score numeric,
  add column if not exists match_percent integer,
  add column if not exists inputs_hash text,
  add column if not exists skipped_reason text;

create index if not exists matches_inputs_hash_idx on matches (event_id, user_id, inputs_hash);
