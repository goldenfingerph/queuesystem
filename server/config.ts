import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  // Bind to 0.0.0.0 so other computers on the LAN can reach the server via the
  // server's local IP. Overridable via env for loopback-only development.
  host: env.HOST ?? '0.0.0.0',
  dbPath: env.DB_PATH ?? path.resolve(__dirname, 'data', 'infinity.db'),
  adsDir: env.ADS_DIR ?? path.resolve(__dirname, 'public', 'ads'),
  logoDir: env.LOGO_DIR ?? path.resolve(__dirname, 'public', 'logo'),
  backupsDir: env.BACKUPS_DIR ?? path.resolve(__dirname, 'data', 'backups'),
  corsOrigin: env.CORS_ORIGIN ?? '*',
  // JWT/signing secret placeholder — auth module lands in a later stage.
  jwtSecret: env.JWT_SECRET ?? 'infinity-local-dev-secret-change-me',
} as const;

export type ServerConfig = typeof config;
