import type Database from 'better-sqlite3';

export interface AuditEntry {
  actorUserId?: number | null;
  actorUsername: string;
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  details?: Record<string, string | number | boolean | null>;
  ipAddress?: string | null;
}

/** Store a structured audit event. Callers must never pass passwords, tokens, or secrets. */
export function writeAuditLog(db: Database.Database, entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_logs
      (actor_user_id, actor_username, action, target_type, target_id, details_json, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.actorUserId ?? null,
    entry.actorUsername.slice(0, 100),
    entry.action.slice(0, 80),
    entry.targetType?.slice(0, 80) ?? null,
    entry.targetId == null ? null : String(entry.targetId).slice(0, 100),
    JSON.stringify(entry.details ?? {}),
    entry.ipAddress?.slice(0, 64) ?? null,
  );
}
