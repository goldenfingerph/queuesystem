import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const ROUNDS = 10;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  if (!hash || hash === 'CHANGE_ME') return false;
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

const SESSION_HOURS = 12;

export function sessionExpiry(): string {
  const d = new Date();
  d.setHours(d.getHours() + SESSION_HOURS);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
