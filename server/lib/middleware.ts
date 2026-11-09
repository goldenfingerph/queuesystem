import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/index.js';
import { generateToken, hashToken, sessionExpiry } from '../lib/auth.js';

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const token = header.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  const tokenHash = hashToken(token);
  const db = getDb();
  const row = db.prepare(
    `SELECT s.token, s.expires_at, u.id, u.username, u.display_name, u.role
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE (s.token = ? OR s.token = ?) AND u.is_active = 1`,
  ).get(tokenHash, token) as
    | { token: string; expires_at: string; id: number; username: string; display_name: string; role: string }
    | undefined;

  if (!row) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  const expiry = getDb().prepare("SELECT datetime('now') >= ? AS expired").get(row.expires_at) as { expired: number } | undefined;
  if (expiry?.expired) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(row.token);
    res.status(401).json({ error: 'Session expired' });
    return;
  }
  // Upgrade pre-hardening sessions in place without forcing active users to sign in again.
  if (row.token === token) db.prepare('UPDATE sessions SET token = ? WHERE token = ?').run(tokenHash, token);
  req.user = { id: row.id, username: row.username, display_name: row.display_name, role: row.role };
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

export function createSession(userId: number): string {
  const db = getDb();
  const token = generateToken();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    hashToken(token),
    userId,
    sessionExpiry(),
  );
  return token;
}

export function destroySession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token = ? OR token = ?').run(hashToken(token), token);
}
