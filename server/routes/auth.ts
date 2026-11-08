import { Router } from 'express';
import { getDb } from '../db/index.js';
import { hashPassword, hashToken, verifyPassword } from '../lib/auth.js';
import { authMiddleware, createSession, destroySession, type AuthUser } from '../lib/middleware.js';

type LoginAttempt = { count: number; windowStarted: number; blockedUntil: number };

export function authRouter(): Router {
  const router = Router();
  const failedLogins = new Map<string, LoginAttempt>();
  const failedLoginsByIp = new Map<string, LoginAttempt>();
  const LOGIN_WINDOW_MS = 15 * 60 * 1000;
  const LOGIN_BLOCK_MS = 15 * 60 * 1000;
  const MAX_LOGIN_FAILURES_PER_ACCOUNT = 5;
  const MAX_LOGIN_FAILURES_PER_IP = 20;
  const MAX_TRACKED_LOGIN_KEYS = 10_000;
  const MAX_TRACKED_IPS = 5_000;

  const loginKey = (ip: string, username: string) => `${ip}:${username.trim().toLowerCase()}`;

  const pruneExpired = (attempts: Map<string, LoginAttempt>, now: number) => {
    for (const [key, attempt] of attempts) {
      if (now - attempt.windowStarted >= LOGIN_WINDOW_MS && attempt.blockedUntil <= now) {
        attempts.delete(key);
      }
    }
  };

  const recordFailure = (
    attempts: Map<string, LoginAttempt>,
    key: string,
    limit: number,
    maxEntries: number,
    now: number,
  ) => {
    const current = attempts.get(key);
    const next: LoginAttempt = !current || now - current.windowStarted >= LOGIN_WINDOW_MS
      ? { count: 1, windowStarted: now, blockedUntil: 0 }
      : { ...current, count: current.count + 1 };
    if (next.count >= limit) next.blockedUntil = now + LOGIN_BLOCK_MS;

    // Bound memory usage if an attacker rotates usernames or source addresses.
    if (!current && attempts.size >= maxEntries) {
      const oldestKey = attempts.keys().next().value;
      if (oldestKey !== undefined) attempts.delete(oldestKey);
    }
    attempts.delete(key);
    attempts.set(key, next);
  };

  router.post('/login', (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' ||
        !username.trim() || !password || username.length > 100 || password.length > 200) {
      res.status(400).json({ error: 'Valid username and password are required' });
      return;
    }

    // Express does not trust forwarded IP headers by default. Use the socket
    // address as a fallback so clients cannot bypass the limit with X-Forwarded-For.
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = loginKey(ip, username);
    const now = Date.now();
    pruneExpired(failedLogins, now);
    pruneExpired(failedLoginsByIp, now);

    const accountBlockedUntil = failedLogins.get(key)?.blockedUntil ?? 0;
    const ipBlockedUntil = failedLoginsByIp.get(ip)?.blockedUntil ?? 0;
    const blockedUntil = Math.max(accountBlockedUntil, ipBlockedUntil);
    if (blockedUntil > now) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((blockedUntil - now) / 1000))));
      res.status(429).json({ error: 'Too many login attempts. Please wait before trying again.' });
      return;
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | { id: number; username: string; password_hash: string; display_name: string; role: string; is_active: number }
      | undefined;
    if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
      recordFailure(failedLogins, key, MAX_LOGIN_FAILURES_PER_ACCOUNT, MAX_TRACKED_LOGIN_KEYS, now);
      recordFailure(failedLoginsByIp, ip, MAX_LOGIN_FAILURES_PER_IP, MAX_TRACKED_IPS, now);
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
      db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\\'now\\') WHERE id = ?')
        .run(hashPassword(newPassword), req.user!.id);
      // Keep this device signed in, but expire every other session for the account.
      db.prepare("UPDATE sessions SET expires_at = datetime('now') WHERE user_id = ? AND token <> ?")
        .run(req.user!.id, hashToken(currentToken));
    });
    updatePassword();
    res.json({ status: 'ok' });
  });

  return router;
}
