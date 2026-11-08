-- Additive indexes for stable ticket history pagination and queue lookups.
-- Existing ticket rows and records are not modified by this migration.
CREATE INDEX IF NOT EXISTS idx_tickets_created_id
  ON tickets(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_status_created_id
  ON tickets(status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_service_created_id
  ON tickets(service_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_counter_status
  ON tickets(counter_id, status);

CREATE INDEX IF NOT EXISTS idx_tickets_queue_lookup
  ON tickets(status, queued_for_counter_id, service_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_queue_events_ticket_type_id
  ON queue_events(ticket_id, event_type, id DESC);
