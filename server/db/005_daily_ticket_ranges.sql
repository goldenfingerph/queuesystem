-- Daily ticket ranges per service. Business day changes at 06:00 Asia/Dubai.
ALTER TABLE services ADD COLUMN ticket_range_start INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE services ADD COLUMN ticket_range_end INTEGER NOT NULL DEFAULT 1499;

-- Assign non-overlapping ranges by service order, not by database ID.
-- Use 500-number blocks when there are 18 or fewer services. If there are
-- more, divide the available 9,000 four-digit numbers evenly without overlap.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY id) AS rn,
         COUNT(*) OVER () AS total
  FROM services
)
UPDATE services
SET ticket_range_start = (
      SELECT CASE WHEN total <= 18
        THEN 1000 + ((rn - 1) * 500)
        ELSE 1000 + CAST((rn - 1) * 9000 / total AS INTEGER)
      END
      FROM ranked WHERE ranked.id = services.id
    ),
    ticket_range_end = (
      SELECT CASE WHEN total <= 18
        THEN 1499 + ((rn - 1) * 500)
        ELSE 999 + CAST(rn * 9000 / total AS INTEGER)
      END
      FROM ranked WHERE ranked.id = services.id
    );

ALTER TABLE tickets ADD COLUMN business_date TEXT;
UPDATE tickets SET business_date = substr(created_at, 1, 10) WHERE business_date IS NULL;
DROP INDEX IF EXISTS idx_tickets_service_number;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_service_day_number
  ON tickets(service_id, business_date, number);
CREATE INDEX IF NOT EXISTS idx_tickets_business_date ON tickets(business_date);
