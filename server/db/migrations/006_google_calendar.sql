-- Google Calendar link (one Google account for the whole hub).
CREATE TABLE google_link (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  email           TEXT,
  refresh_token   TEXT NOT NULL,
  hub_calendar_id TEXT,              -- the "visits" calendar the hub created and owns
  sync_token      TEXT,              -- Google's incremental sync token for that calendar
  connected_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_sync_at    TEXT,
  last_error      TEXT
);

-- The family calendars shown (and editable) in the hub.
CREATE TABLE google_calendars (
  calendar_id TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT,
  writable    INTEGER NOT NULL DEFAULT 0
);

-- One Google event per visit day on the hub calendar. etag = the version the hub last wrote or saw,
-- so the hub can tell its own changes from edits made in Google.
CREATE TABLE google_visit_events (
  date        TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL UNIQUE,
  summary     TEXT NOT NULL,
  description TEXT NOT NULL,
  etag        TEXT
);

-- A local copy of the family calendars' events (refreshed every sync), so pages never wait on Google.
-- Dates and times are in the house's time zone; end_date is inclusive.
CREATE TABLE google_events (
  calendar_id TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  start_time  TEXT,                  -- 'HH:MM', NULL for all-day events
  end_time    TEXT,
  location    TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  recurring   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (calendar_id, event_id)
);
CREATE INDEX google_events_dates ON google_events (start_date, end_date);
