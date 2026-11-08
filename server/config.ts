import fs from 'node:fs';
import net from 'node:net';
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
  // Configure both paths to serve HTTPS and secure WebSockets (WSS).
  tlsCertFile: env.TLS_CERT_FILE ? path.resolve(env.TLS_CERT_FILE) : null,
  tlsKeyFile: env.TLS_KEY_FILE ? path.resolve(env.TLS_KEY_FILE) : null,
} as const;

export type ServerConfig = typeof config;

/**
 * Validate operator-supplied environment values before database migrations
 * or first-run administrator initialization can change persistent state.
 * This function deliberately validates paths without creating directories.
 */
export function validateServerEnvironment(values: NodeJS.ProcessEnv = process.env): void {
  const errors: string[] = [];
  const portText = values.PORT ?? '4000';
  const port = Number(portText);
  if (!portText || String(port) !== portText || !Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be a whole number from 1 to 65535.');
  }

  const host = values.HOST ?? '0.0.0.0';
  const hostname = host.endsWith('.') ? host.slice(0, -1) : host;
  const validHostname = hostname.length > 0 && hostname.length <= 253 &&
    hostname.split('.').every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
  if (!host.trim() || host !== host.trim() || (net.isIP(host) === 0 && !validHostname)) {
    errors.push('HOST must be a valid IP address or DNS hostname.');
  }

  for (const name of ['DB_PATH', 'ADS_DIR', 'LOGO_DIR', 'BACKUPS_DIR'] as const) {
    const value = values[name];
    if (value !== undefined && (!value.trim() || value.includes(String.fromCharCode(0)) {
      errors.push(`${name} must be a non-empty valid path when configured.`);
    }
  }

  const cert = values.TLS_CERT_FILE;
  const key = values.TLS_KEY_FILE;
  if ((cert === undefined) !== (key === undefined)) {
    errors.push('TLS_CERT_FILE and TLS_KEY_FILE must be configured together.');
  }
  for (const [name, value] of [['TLS_CERT_FILE', cert], ['TLS_KEY_FILE', key]] as const) {
    if (value !== undefined) {
      if (!value.trim() || value.includes(String.fromCharCode(0)) {
        errors.push(`${name} must be a non-empty valid path when configured.`);
        continue;
      }
      try {
        fs.accessSync(path.resolve(value), fs.constants.R_OK);
      } catch {
        errors.push(`${name} points to a file that does not exist or cannot be read.`);
      }
    }
  }

  const bootstrapPassword = values.ADMIN_INITIAL_PASSWORD;
  if (bootstrapPassword !== undefined && (bootstrapPassword.length < 12 || bootstrapPassword.length > 200)) {
    errors.push('ADMIN_INITIAL_PASSWORD must be 12 to 200 characters when configured.');
  }

  if (errors.length > 0) {
    throw new Error('Invalid server environment configuration:' + String.fromCharCode(10) + '- ' + errors.join(String.fromCharCode(10) + '- '));
  }
}
