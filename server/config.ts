import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

function readPort(value: string | undefined): number {
  if (value === undefined) return 4000;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`[config] Invalid PORT "${value}". PORT must be an integer from 1 to 65535.`);
  }

  const port = Number(normalized);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[config] Invalid PORT "${value}". PORT must be an integer from 1 to 65535.`);
  }
  return port;
}

function readNonEmpty(name: string, value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`[config] Invalid ${name}. The value must not be empty.`);
  }
  return normalized;
}

const initialAdminPassword = env.ADMIN_INITIAL_PASSWORD;
if (initialAdminPassword !== undefined && initialAdminPassword.length < 12) {
  throw new Error('[config] Invalid ADMIN_INITIAL_PASSWORD. When provided, it must be at least 12 characters long.');
}

export const config = {
  port: readPort(env.PORT),
  // Bind to 0.0.0.0 so other computers on the LAN can reach the server via the
  // server's local IP. Overridable via env for loopback-only development.
  host: readNonEmpty('HOST', env.HOST, '0.0.0.0'),
  dbPath: readNonEmpty('DB_PATH', env.DB_PATH, path.resolve(__dirname, 'data', 'infinity.db')),
  adsDir: readNonEmpty('ADS_DIR', env.ADS_DIR, path.resolve(__dirname, 'public', 'ads')),
  logoDir: readNonEmpty('LOGO_DIR', env.LOGO_DIR, path.resolve(__dirname, 'public', 'logo')),
  backupsDir: readNonEmpty('BACKUPS_DIR', env.BACKUPS_DIR, path.resolve(__dirname, 'data', 'backups')),
  corsOrigin: env.CORS_ORIGIN ?? '*',
  // JWT/signing secret placeholder — auth module lands in a later stage.
  jwtSecret: env.JWT_SECRET ?? 'infinity-local-dev-secret-change-me',
} as const;

export type ServerConfig = typeof config;
