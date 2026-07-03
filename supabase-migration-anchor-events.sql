-- Anchor Events system
-- Run this in the Supabase SQL editor at: Project → SQL Editor → New query

-- 1. anchor_events: one record per conference/anchor (e.g. Dreamforce '26)
CREATE TABLE IF NOT EXISTS anchor_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text UNIQUE NOT NULL,          -- URL path, e.g. "dreamforce-26"
  title           text NOT NULL DEFAULT '',      -- Page H1, e.g. "Dreamforce '26 Side Events"
  anchor_name     text NOT NULL DEFAULT '',      -- Conference name, e.g. "Dreamforce"
  anchor_url      text NOT NULL DEFAULT '',      -- Link to main conference site
  anchor_icon_url text NOT NULL DEFAULT '',      -- Icon/logo URL shown in page header
  description     text NOT NULL DEFAULT '',      -- Optional subtitle / hero copy
  status          text NOT NULL DEFAULT 'draft', -- 'draft' | 'live'
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 2. anchor_event_events: ordered list of side events for each anchor event
CREATE TABLE IF NOT EXISTS anchor_event_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anchor_event_id  uuid NOT NULL REFERENCES anchor_events(id) ON DELETE CASCADE,
  event_id         text NOT NULL,                -- Supabase/Airtable events.id (text)
  position         integer NOT NULL DEFAULT 0,  -- display order, ascending
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (anchor_event_id, event_id)
);

CREATE INDEX IF NOT EXISTS anchor_event_events_anchor_id_idx
  ON anchor_event_events(anchor_event_id, position);

-- 3. offers: sponsor/partner deals shown on anchor event pages (and future email footers)
CREATE TABLE IF NOT EXISTS offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL DEFAULT '',
  logo_url    text NOT NULL DEFAULT '',
  banner_url  text NOT NULL DEFAULT '',
  cta_text    text NOT NULL DEFAULT '',  -- Button label, e.g. "Get 20% off"
  url         text NOT NULL DEFAULT '',  -- Destination URL
  status      text NOT NULL DEFAULT 'active',  -- 'active' | 'inactive'
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 4. anchor_event_offers: ordered list of offers for each anchor event
CREATE TABLE IF NOT EXISTS anchor_event_offers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anchor_event_id  uuid NOT NULL REFERENCES anchor_events(id) ON DELETE CASCADE,
  offer_id         uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  position         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (anchor_event_id, offer_id)
);

CREATE INDEX IF NOT EXISTS anchor_event_offers_anchor_id_idx
  ON anchor_event_offers(anchor_event_id, position);
