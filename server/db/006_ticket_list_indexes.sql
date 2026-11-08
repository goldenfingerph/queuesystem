-- Indexes for the ticket history endpoint's newest-first ordering and filters.
-- Keep existing indexes intact; these support the unfiltered and service-filtered
-- paginated list without changing queue selection or ticket allocation.
CREATE INDEX IF NOT EXISTS idx_tickets_created_id
  ON tickets(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_service_created_id
  ON tickets(service_id, created_at DESC, id DESC);
