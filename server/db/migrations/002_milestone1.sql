-- Milestone 1 additions (001 is never edited once applied).

-- Recurring generation bookkeeping: instances exist for every due date up to this day.
ALTER TABLE tasks ADD COLUMN generated_through TEXT;
-- Soft delete: history (done instances, activity log) is never lost.
ALTER TABLE tasks ADD COLUMN deleted_at TEXT;

-- Why an instance is 'skipped': hidden by a "hide" out day, or merged into an earlier open
-- occurrence of the same recurring task. Both can be revived when schedule/out days change.
ALTER TABLE task_instances ADD COLUMN skip_reason TEXT CHECK (skip_reason IN ('out_day','merged'));

-- A visit that has been finished with "All done". Later tasks go to the following visit.
CREATE TABLE visit_closures (
  date      TEXT PRIMARY KEY,
  closed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_by TEXT NOT NULL CHECK (closed_by IN ('housekeeper','family'))
);
