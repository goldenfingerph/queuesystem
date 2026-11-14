-- Enable TV voice announcements by default on fresh and upgraded installations.
-- Preserve an explicit administrator choice of '0' (disabled).
INSERT INTO system_settings (key, value)
VALUES ('voice_enabled', '1')
ON CONFLICT(key) DO NOTHING;
