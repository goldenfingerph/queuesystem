-- Preserve original ticket identity and waiting time on transfers.
ALTER TABLE tickets ADD COLUMN transfer_priority INTEGER NOT NULL DEFAULT 0;

-- Ticket numbers reset by business day. Keep ordinary ticket numbers unique
-- within each service and business date, while allowing a transferred ticket
-- to retain its original number even when that number already exists at the
-- destination service on the same business day.
DROP INDEX IF EXISTS idx_tickets_service_number;
DROP INDEX IF EXISTS idx_tickets_service_day_number;
CREATE UNIQUE INDEX idx_tickets_service_day_number
  ON tickets(service_id, business_date, number)
  WHERE transfer_priority = 0;
