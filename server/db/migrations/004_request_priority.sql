-- Requests get the same three priorities as tasks: 1 = high, 2 = normal, 3 = low.
ALTER TABLE requests ADD COLUMN priority INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1,2,3));
