import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/index.js';
import { generateToken, sessionExpiry } from '../lib/auth.js';

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
  const db = getDb();
  const row = db.prepare(
    `SELECT s.token, s.expires_at, u.id, u.username, u.display_name, u.role
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.token = ? AND u.is_active = 1`,
  ).get(token) as
    | { token: string; expires_at: string; id: number; username: string; display_name: string; role: string }
    | undefined;

  if (!row) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  const expiry = getDb().prepare("SELECT datetime('now') >= ? AS expired").get(row.expires_at) as { expired: number } | undefined;
  if (expiry?.expired) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.status(401).json({ error: 'Session expired' });
    return;
  }
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
    token,
    userId,
    sessionExpiry(),
  );
  return token;
}

export function destroySession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
