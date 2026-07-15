-- Add start_time and featured to anchor_event_events
ALTER TABLE anchor_event_events
  ADD COLUMN IF NOT EXISTS start_time TEXT,
  ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE;
