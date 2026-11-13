-- v3: first-run setup state.
-- Fresh databases declare setup incomplete in v1. Existing databases have no row,
-- so this migration marks them configured and never interrupts an existing customer.
CREATE TABLE IF NOT EXISTS setup_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  completed_at TEXT
);
INSERT INTO setup_state (id, completed, completed_at)
SELECT 1, 1, datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM setup_state WHERE id = 1);
