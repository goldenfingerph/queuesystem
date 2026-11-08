import { Router } from 'express';
import { getDb } from '../db/index.js';
import { verifyPassword, hashPassword } from '../lib/auth.js';
import { authMiddleware, createSession, destroySession, type AuthUser } from '../lib/middleware.js';

export function authRouter(): Router {
  const router = Router();
  const failedLogins = new Map<string, { count: number; windowStarted: number; blockedUntil: number }>();
  const LOGIN_WINDOW_MS = 15 * 60 * 1000;
  const LOGIN_BLOCK_MS = 15 * 60 * 1000;
  const MAX_LOGIN_FAILURES = 5;
  // A second, IP-wide limit prevents attackers from bypassing the per-account
  // threshold by rotating through many usernames from the same client.
  const failedLoginsByIp = new Map<string, { count: number; windowStarted: number; blockedUntil: number }>();
  const MAX_IP_LOGIN_FAILURES = 30;

  const loginKey = (ip: string, username: string) => `${ip}:${username.trim().toLowerCase()}`;
  const recordFailure = (
    store: Map<string, { count: number; windowStarted: number; blockedUntil: number }>,
    key: string,
    threshold: number,
  ) => {
    const now = Date.now();
    const current = store.get(key);
    if (!current || now - current.windowStarted >= LOGIN_WINDOW_MS) {
      store.set(key, { count: 1, windowStarted: now, blockedUntil: 0 });
      return;
    }
    current.count += 1;
    if (current.count >= threshold) current.blockedUntil = now + LOGIN_BLOCK_MS;
    store.set(key, current);
  };

  const recordLoginFailure = (ip: string, key: string) => {
    recordFailure(failedLogins, key, MAX_LOGIN_FAILURES);
    recordFailure(failedLoginsByIp, ip, MAX_IP_LOGIN_FAILURES);
  };

  const pruneExpiredAttempts = (now: number) => {
    // Keep the in-memory limiter bounded during long-running LAN deployments.
    for (const [key, attempt] of failedLogins) {
      if (now - attempt.windowStarted >= LOGIN_WINDOW_MS && attempt.blockedUntil <= now) failedLogins.delete(key);
    }
    for (const [ip, attempt] of failedLoginsByIp) {
      if (now - attempt.windowStarted >= LOGIN_WINDOW_MS && attempt.blockedUntil <= now) failedLoginsByIp.delete(ip);
    }
  };

  router.post('/login', (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' ||
        !username.trim() || !password || username.length > 100 || password.length > 200) {
      res.status(400).json({ error: 'Valid username and password are required' });
      return;
    }
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = loginKey(ip, username);
    const now = Date.now();
    pruneExpiredAttempts(now);
    const ipAttempt = failedLoginsByIp.get(ip);
    if (ipAttempt?.blockedUntil && ipAttempt.blockedUntil > now) {
      res.status(429).json({ error: 'Too many login attempts from this network address. Please wait 15 minutes and try again.' });
      return;
    }
    const attempt = failedLogins.get(key);
    if (attempt?.blockedUntil && attempt.blockedUntil > now) {
      res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes and try again.' });
      return;
    }
    if (attempt && now - attempt.windowStarted >= LOGIN_WINDOW_MS) failedLogins.delete(key);
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | { id: number; username: string; password_hash: string; display_name: string; role: string; is_active: number }
      | undefined;
    if (!user || !user.is_active) {
      recordLoginFailure(ip, key);
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    let passwordValid = verifyPassword(password, user.password_hash);

    // Secure first-run recovery: the operator supplies a one-time password
    // through the Windows environment. It is immediately replaced by bcrypt.
    const bootstrapPassword = process.env.ADMIN_INITIAL_PASSWORD;
    if (
      !passwordValid &&
      user.username === 'admin' &&
      typeof bootstrapPassword === 'string' &&
      bootstrapPassword.length >= 12 &&
      password === bootstrapPassword
    ) {
      const newHash = hashPassword(password);
      db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
        .run(newHash, user.id);
      passwordValid = true;
    }

    if (!passwordValid) {
      recordLoginFailure(ip, key);
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    failedLogins.delete(key);
    const token = createSession(user.id);
    const authUser: AuthUser = {
      id: user.id, username: user.username, display_name: user.display_name, role: user.role,
    };
    res.json({ token, user: authUser });
  });

  router.post('/logout', authMiddleware, (req, res) => {
    const token = req.headers.authorization!.slice(7);
    destroySession(token);
    res.json({ status: 'ok' });
  });

  router.get('/me', authMiddleware, (req, res) => {
    res.json({ user: req.user });
  });

  router.post('/change-password', authMiddleware, (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current and new password required' });
      return;
    }
    if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 200) {
      res.status(400).json({ error: 'Password must be 12–200 characters' });
      return;
    }
    const db = getDb();
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string };
    if (!verifyPassword(currentPassword, user.password_hash)) {
      res.status(401).json({ error: 'Current password incorrect' });
      return;
    }
    const currentToken = req.headers.authorization!.slice(7);
    const updatePassword = db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(hashPassword(newPassword), req.user!.id);
      // Keep this device signed in, but expire every other session for the account.
      db.prepare("UPDATE sessions SET expires_at = datetime('now') WHERE user_id = ? AND token <> ?")
        .run(req.user!.id, currentToken);
    });
    updatePassword();
    res.json({ status: 'ok' });
  });

  return router;
}
