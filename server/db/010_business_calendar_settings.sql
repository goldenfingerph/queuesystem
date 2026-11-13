-- Configurable company operating timezone and business-day rollover.
-- Defaults retain existing UAE installations without changing their ticket dates.
INSERT INTO system_settings (key, value) VALUES
  ('business_timezone', 'Asia/Dubai'),
  ('business_day_start', '06:00')
ON CONFLICT(key) DO NOTHING;
