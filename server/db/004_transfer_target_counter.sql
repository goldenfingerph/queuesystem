-- v4: pin transferred waiting tickets to their selected destination counter
ALTER TABLE tickets ADD COLUMN queued_for_counter_id INTEGER REFERENCES counters(id);
CREATE INDEX IF NOT EXISTS idx_tickets_queued_counter
  ON tickets(queued_for_counter_id, status, created_at);
