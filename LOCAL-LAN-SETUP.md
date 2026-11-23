# QueueSystem — Windows Local LAN Setup

This guide is for the current `goldenfingerph/queuesystem` project on the `main` branch. It replaces older setup notes that referred to a different repository and branch.

For complete operating instructions, see [USER-MANUAL.md](USER-MANUAL.md). For common errors, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Intended network layout

- One Windows 11 x64 PC hosts the QueueSystem server and its SQLite database.
- Reception, counter workstations, and the TV display connect to that server over the same trusted private LAN.
- Default server port: TCP 4000.
- Default bind address: `0.0.0.0`.
- Local database: `server/data/infinity.db`.
- Backups: `server/data/backups/`.

Keep the live SQLite database on the server PC's local disk. Never place the database or its WAL files on a shared network drive.

## Installation and first launch

For production, use only the final approved commercial Setup Wizard once it has completed installer validation and the fresh Windows 11 installation test. Do not use an old test installer.

For a current source/project package:

1. Extract the complete package to a permanent writable folder on the server PC.
2. Confirm the package includes the bundled Node.js 22 runtime under `runtime/node/`.
3. Run `INSTALL-INFINITY-SERVICES.bat` once.
4. Run `START-INFINITY-SERVICES.bat` and keep its window open while the server is in use.
5. On the server PC, open `http://localhost:4000`.
6. Complete the one-time QueueSystem setup screen, including organization details, language, timezone, business-day start, and administrator credentials.

The current package bundles Node.js 22 and npm. A system-wide Node.js installation should not be necessary when the complete self-contained package is used.

## Allow LAN clients

1. On the server PC, run `ipconfig` and note the active LAN adapter's IPv4 address.
2. Reserve that address in the router/DHCP settings.
3. If Windows Firewall blocks LAN connections, run `ALLOW-LAN-FIREWALL.bat` and approve Administrator permission. The rule is limited to the Private profile and local subnet.
4. On each reception, counter, and TV device, open `http://SERVER-PC-IP:4000`.

Do not expose TCP port 4000 to the public internet. Default HTTP/WS mode is unencrypted. Configure a trusted TLS certificate for HTTPS/WSS where encrypted transport is required; see [HTTPS-WSS-SETUP.md](HTTPS-WSS-SETUP.md).

## Backups

In QueueSystem, sign in with an authorized administrator account, open System Settings, and select **Create Backup Now**. Confirm that the backup appears in the list, download it, and copy it to protected storage separate from the server PC.

The database backup does not include local advertisement media or TLS certificate files. Back up `server/public/ads/` separately when used, and protect certificate/private-key files separately.

## Restore

Stop the QueueSystem server and its startup watchdog before restoring. Copy the chosen `.db` file into `server/data/backups/`, keep a separate copy of the current database, and run `RESTORE-INFINITY-BACKUP.bat`. Enter the exact backup filename. The restore process validates the file and creates a safety copy before replacing the database.

Restart QueueSystem and verify login, organization settings, counters, tickets, and reports before returning to normal service. Never replace a live database while the server is running.

## Automatic startup and power recovery

The Windows startup helper is designed to start the server and open the TV display after the Windows user signs in. BIOS/UEFI power recovery, Windows automatic sign-in, and sleep settings must be configured locally by an administrator. See [WINDOWS-AUTO-RECOVERY-GUIDE.md](WINDOWS-AUTO-RECOVERY-GUIDE.md).

Actual restart, printing, audio, LAN, and power-recovery behavior must be checked on the target Windows PC and client devices before production use.
