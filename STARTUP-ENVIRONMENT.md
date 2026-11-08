# Windows Startup Environment Configuration

The supported Windows startup path remains `START-INFINITY-SERVICES.bat`. It changes to the project folder and runs the existing `npm run start` command. Docker is not required.

The server validates its environment before opening SQLite, running database migrations, or changing the first-run administrator password. Invalid settings stop startup with a clear error; the validator does not create, reset, or delete database files.

## Supported runtime

- Node.js 22.x
- Default server port: `4000`
- Default bind address: `0.0.0.0` (other devices on the private LAN can connect)

## Optional environment variables

| Variable | Default / requirement |
| --- | --- |
| `PORT` | `4000`; whole number from 1 to 65535 |
| `HOST` | `0.0.0.0`; valid IP address or DNS hostname |
| `DB_PATH` | `server/data/infinity.db` |
| `ADS_DIR` | `server/public/ads` |
| `LOGO_DIR` | `server/public/logo` |
| `BACKUPS_DIR` | `server/data/backups` |
| `QUEUE_EVENT_RETENTION_DAYS` | `365`; whole number from 30 to 3650 days |
| `ADMIN_INITIAL_PASSWORD` | Optional; if supplied, 12 to 200 characters. Used only for first-run admin initialization and cleared from process memory afterward. |
| `TLS_CERT_FILE` | Optional certificate path; must be configured together with `TLS_KEY_FILE` and point to a readable file |
| `TLS_KEY_FILE` | Optional private-key path; must be configured together with `TLS_CERT_FILE` and point to a readable file |

Custom relative paths are interpreted from the project folder when started with the supplied batch file. Absolute paths are recommended for custom data locations.

## Queue event retention

The server automatically checks queue-event history at startup and once every 24 hours. By default, it prunes event rows older than 365 days only when their ticket is terminal (`completed`, `no_show`, or `transferred`). It keeps the final event for each ticket, all events for active tickets, and every ticket record. This retention applies only to the `queue_events` audit log; ticket history and reports remain based on the retained `tickets` rows. Set `QUEUE_EVENT_RETENTION_DAYS` to change the window (minimum 30 days, maximum 3650 days). Invalid values stop startup before the database is opened. A maintenance error is logged and does not stop the queue server.

## TLS behavior

The batch file automatically detects `server/certs/server.crt` and `server/certs/server.key`. If both exist, it supplies the corresponding environment variables and the server enables HTTPS/WSS. If they are missing, the existing HTTP/WS LAN mode remains available with an explicit warning. A certificate must still be trusted by every client device; see [HTTPS-WSS-SETUP.md](HTTPS-WSS-SETUP.md).

## PWA and offline behavior

The production build includes `public/manifest.webmanifest`, the app icon, and a service worker. On HTTPS (or localhost), supported browsers can offer installation as an app. The service worker caches only the static app shell and frontend assets so the interface can open during a temporary connection loss. It never caches API responses, queue data, login/session responses, advertisement media, or WebSocket traffic; live queue operations still require the server connection.

The default Windows LAN mode is HTTP/WS and therefore is not a secure context for service-worker installation on other devices. To install the PWA on staff PCs, tablets, or the TV, configure a trusted HTTPS certificate using [HTTPS-WSS-SETUP.md](HTTPS-WSS-SETUP.md). Existing browser access over HTTP continues to work without PWA installation or offline caching.

The TV display keeps its live queue updates and now-serving announcements separate from offline shell caching. Use the TV audio control to enable or disable voice announcements after the browser permits audio playback.

## Startup errors

Correct the environment variable named in the error message, then run `START-INFINITY-SERVICES.bat` again. The server checks port range, host syntax, configured paths, TLS certificate/key pairing and readability, and bootstrap-password length before it opens the database. It does not automatically modify existing queue data or backups.
