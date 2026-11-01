-- Household features (001 and 002 are never edited once applied).

-- People in the house. Exactly one housekeeper is expected; adults and the housekeeper can own tasks.
CREATE TABLE members (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('housekeeper','adult','child','baby')),
  sort       INTEGER NOT NULL DEFAULT 0,
  removed_at TEXT
);
INSERT INTO members (name, role, sort) VALUES
  ('Gladis','housekeeper',1), ('Bill','adult',2), ('Falon','adult',3), ('Sian','child',4), ('William','baby',5);

-- Task options.
--   priority:    1 = high, 2 = normal, 3 = low
--   owner_id:    who does it; NULL = the housekeeper. Housekeeper tasks follow her visit days,
--                anyone else's follow their own dates.
--   period:      'day' = on its date; 'week'/'month' = any time in the week/month of its date
--   if_not_done: 'carry' = keep carrying over; 'drop' = remove after its day/period;
--                'expire' = carry over, but remove once expire_days have passed after its day/period
ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1,2,3));
ALTER TABLE tasks ADD COLUMN owner_id INTEGER REFERENCES members(id);
ALTER TABLE tasks ADD COLUMN period TEXT NOT NULL DEFAULT 'day' CHECK (period IN ('day','week','month'));
ALTER TABLE tasks ADD COLUMN if_not_done TEXT NOT NULL DEFAULT 'carry' CHECK (if_not_done IN ('carry','drop','expire'));
ALTER TABLE tasks ADD COLUMN expire_days INTEGER CHECK (expire_days IS NULL OR expire_days BETWEEN 1 AND 365);

-- Removed because it was not done in time (status 'skipped', skip_reason NULL: never revived).
ALTER TABLE task_instances ADD COLUMN expired_at TEXT;

-- Extra visit days on top of the weekly schedule, and a note for any day the family should see.
CREATE TABLE extra_visits (
  date       TEXT PRIMARY KEY,
  created_by TEXT NOT NULL CHECK (created_by IN ('housekeeper','family')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE day_notes (
  date       TEXT PRIMARY KEY,
  note       TEXT NOT NULL,
  updated_by TEXT NOT NULL CHECK (updated_by IN ('housekeeper','family')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Things the family is looking for. Shown as a red banner until someone finds it.
CREATE TABLE lost_items (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  details    TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL CHECK (created_by IN ('housekeeper','family')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  found_at   TEXT,
  found_by   TEXT CHECK (found_by IN ('housekeeper','family')),
  found_note TEXT NOT NULL DEFAULT ''
);

-- Groceries: "Out" (needed now) vs normal, and items that come back on the list by themselves.
ALTER TABLE grocery_items ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0;
CREATE TABLE grocery_staples (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  quantity   TEXT NOT NULL DEFAULT '',
  every_days INTEGER NOT NULL CHECK (every_days BETWEEN 1 AND 365),
  next_on    TEXT NOT NULL,             -- the day it is next put on the list
  created_by TEXT NOT NULL CHECK (created_by IN ('housekeeper','family')),
  removed_at TEXT
);
