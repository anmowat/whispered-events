ALTER TABLE matches
  ADD COLUMN host_rating text CHECK (host_rating IN ('up', 'down')),
  ADD COLUMN host_feedback text,
  ADD COLUMN host_rated_at timestamptz;

CREATE INDEX ON matches (event_id, host_rating) WHERE host_rating IS NOT NULL;
