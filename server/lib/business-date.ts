import type Database from 'better-sqlite3';
import { getBusinessDate } from '../../shared/business-date.js';

export function getConfiguredBusinessDate(db: Database.Database, now: Date = new Date()): string {
  const rows = db.prepare(
    "SELECT key, value FROM system_settings WHERE key IN ('business_timezone', 'business_day_start')",
  ).all() as Array<{ key: string; value: string }>;
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return getBusinessDate(now, {
    timeZone: settings.business_timezone || 'Asia/Dubai',
    dayStart: settings.business_day_start || '06:00',
  });
}
