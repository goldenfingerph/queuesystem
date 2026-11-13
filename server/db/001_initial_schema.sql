-- v1: initial schema for QueueSystem – Queue Management System
-- All timestamps stored as ISO text for portability.

-- Staff login accounts
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','senior_clerk','service_officer','receptionist')),
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Service categories offered to visitors
CREATE TABLE services (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  description     TEXT,
  prefix          TEXT NOT NULL,
  avg_duration_sec INTEGER DEFAULT 300,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Physical counter workstations (supports 20+)
CREATE TABLE counters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  number     INTEGER NOT NULL,
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_counters_number ON counters(number);

-- Many-to-many: services each counter can handle
CREATE TABLE counter_services (
  counter_id INTEGER NOT NULL,
  service_id INTEGER NOT NULL,
  PRIMARY KEY (counter_id, service_id),
  FOREIGN KEY (counter_id) REFERENCES counters(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
);

-- Current/past assignment of a staff member to a counter
CREATE TABLE staff_assignments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  counter_id INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','break','ended')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at   TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (counter_id) REFERENCES counters(id) ON DELETE CASCADE
);
CREATE INDEX idx_assignments_counter_status ON staff_assignments(counter_id, status);
CREATE INDEX idx_assignments_user ON staff_assignments(user_id);

-- Queue tickets
CREATE TABLE tickets (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  number                 TEXT NOT NULL,
  service_id             INTEGER NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','called','serving','completed','no_show','transferred')),
  priority               TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal','priority','vip')),
  counter_id             INTEGER,
  called_at              TEXT,
  served_at              TEXT,
  completed_at           TEXT,
  transferred_to_service_id INTEGER,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT,
  FOREIGN KEY (counter_id) REFERENCES counters(id) ON DELETE SET NULL,
  FOREIGN KEY (transferred_to_service_id) REFERENCES services(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_tickets_service_number ON tickets(service_id, number);
CREATE INDEX idx_tickets_status_created ON tickets(status, created_at);
CREATE INDEX idx_tickets_counter ON tickets(counter_id);

-- Audit trail for every queue state change (powers reports)
CREATE TABLE queue_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN ('created','called','recalled','started','completed','no_show','transferred')),
  counter_id  INTEGER,
  user_id     INTEGER,
  from_status TEXT,
  to_status   TEXT,
  meta        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (counter_id) REFERENCES counters(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_events_ticket ON queue_events(ticket_id);
CREATE INDEX idx_events_created ON queue_events(created_at);

-- Key/value system configuration
CREATE TABLE system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Uploaded MP4 advertisement metadata (files stored on disk, not in DB)
CREATE TABLE ads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  duration_sec  INTEGER,
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Backup log entries
CREATE TABLE backups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  filename   TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Seed default admin account (password is "admin123" — bcrypt-style hash set later).
-- Using a placeholder hash; the auth module will replace this on first login.
INSERT INTO users (username, password_hash, display_name, role, is_active)
VALUES ('admin', 'CHANGE_ME', 'System Administrator', 'admin', 1)
ON CONFLICT(username) DO NOTHING;

-- Seed default system settings
INSERT INTO system_settings (key, value) VALUES
  ('ticket_padding', '3'),
  ('priority_order', 'vip,priority,normal'),
  ('queue_mode', 'fifo'),
  ('ads_enabled', '1'),
  ('ads_interval_sec', '15')
ON CONFLICT(key) DO NOTHING;
