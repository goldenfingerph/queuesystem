CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Repair any legacy duplicate active assignments before enforcing one active
-- assignment per staff member and one active staff member per counter.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY started_at DESC, id DESC) AS rn
  FROM staff_assignments
  WHERE status = 'active'
)
UPDATE staff_assignments
SET status = 'ended', ended_at = datetime('now')
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY counter_id ORDER BY started_at DESC, id DESC) AS rn
  FROM staff_assignments
  WHERE status = 'active'
)
UPDATE staff_assignments
SET status = 'ended', ended_at = datetime('now')
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_one_active_assignment_per_user
  ON staff_assignments(user_id) WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_one_active_assignment_per_counter
  ON staff_assignments(counter_id) WHERE status = 'active';
