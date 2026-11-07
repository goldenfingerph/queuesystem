-- v3: fix admin password hash (correct bcrypt hash for 'admin123')
-- This unconditionally sets the admin password so it works even if the
-- placeholder in v1/v2 was already applied.
UPDATE users SET password_hash = '$2b$10$uQaqQDxB7.NM8eXTGYxoZevoFmqBzmR89T81uUHI28BZj4Gv9BT0i' WHERE username = 'admin';
