-- Add start_time and end_time to events table
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS start_time TEXT,
  ADD COLUMN IF NOT EXISTS end_time TEXT;
