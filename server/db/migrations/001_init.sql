-- House Hub schema v1. Dates are ISO 'YYYY-MM-DD' in the house's local time zone;
-- timestamps are ISO 8601 UTC strings. Weekdays are ISO: 1=Monday ... 7=Sunday.
-- See docs/DATA-MODEL.md for the reasoning behind each table.

CREATE TABLE recurrence_rules (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('daily','weekly','monthly','every_six_months','custom')),
  interval_n    INTEGER NOT NULL DEFAULT 1 CHECK (interval_n >= 1),
  interval_unit TEXT NOT NULL DEFAULT 'day' CHECK (interval_unit IN ('day','week','month')),
  anchor_date   TEXT NOT NULL,            -- first due date; later dates are computed from this
  ends_on       TEXT                      -- optional last date
);

CREATE TABLE tasks (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','recurring','device')),
  external_id   TEXT,                     -- id in the originating system (device pushes)
  source_meta   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_meta)),
  recurrence_id INTEGER REFERENCES recurrence_rules(id) ON DELETE SET NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT NOT NULL DEFAULT 'family' CHECK (created_by IN ('housekeeper','family','system')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- A device re-sending the same alert must not create duplicates.
CREATE UNIQUE INDEX tasks_source_external ON tasks(source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE task_instances (
  id                 INTEGER PRIMARY KEY,
  task_id            INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  due_date           TEXT NOT NULL,       -- nominal date from the recurrence rule (or requested date)
  visit_date         TEXT NOT NULL,       -- the visit day it is shown on (after schedule + day_overrides)
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
  done_at            TEXT,
  done_by            TEXT CHECK (done_by IN ('housekeeper','family')),
  note               TEXT NOT NULL DEFAULT '',
  rolled_from        TEXT,                -- visit date it was first shown on, set when carried over; non-NULL => show "Carried over"
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (task_id, due_date)
);
CREATE INDEX task_instances_visit ON task_instances(visit_date, status);

CREATE TABLE grocery_items (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  quantity   TEXT NOT NULL DEFAULT '',
  added_by   TEXT NOT NULL CHECK (added_by IN ('housekeeper','family')),
  added_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  bought_at  TEXT,                        -- set when checked off in the store
  cleared_at TEXT                         -- set by "Clear bought"; hidden afterwards
);

CREATE TABLE requests (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('buy','approve','other')),
  status      TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','done')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  approved_at TEXT,
  done_at     TEXT
);

CREATE TABLE schedule (
  weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 1 AND 7),
  active  INTEGER NOT NULL DEFAULT 0
);
-- Default regular visits: Monday, Thursday, Saturday.
INSERT INTO schedule (weekday, active) VALUES (1,1),(2,0),(3,0),(4,1),(5,0),(6,1),(7,0);

CREATE TABLE day_overrides (
  date       TEXT PRIMARY KEY,            -- the regular visit day that is "out"
  reason     TEXT NOT NULL CHECK (reason IN ('appointment','sick','other')),
  mode       TEXT NOT NULL DEFAULT 'shift' CHECK (mode IN ('hide','shift')),
  shifted_to TEXT,                        -- NULL => next regular visit day
  note       TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL CHECK (created_by IN ('housekeeper','family')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE activity_log (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor     TEXT NOT NULL,                -- 'housekeeper' | 'family' | 'system' | 'device:<name>'
  action    TEXT NOT NULL,                -- e.g. 'task.done', 'day.out', 'request.approved'
  entity    TEXT NOT NULL,
  entity_id INTEGER,
  detail    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail))
);
CREATE INDEX activity_log_at ON activity_log(at);
