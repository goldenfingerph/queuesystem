# QueueSystem User Manual

This guide describes the current QueueSystem application and the intended Windows 11 deployment. The final commercial Setup Wizard and a clean Windows installation still require their separate release-phase validation.

## 1. System overview

QueueSystem runs on one Windows server PC. Reception, service counters, and the TV display connect to that PC over the same trusted local area network (LAN).

- Default server port: TCP 4000.
- Local server address: `http://localhost:4000`.
- Other LAN devices: `http://SERVER-PC-IP:4000`.
- Default database: `server/data/infinity.db`.
- Database backups: `server/data/backups/`.

Keep the live SQLite database on the server PC's local disk. Do not place the database or its WAL files on a shared network drive.

## 2. Install and start QueueSystem on Windows

When the final commercial installer is published, use the signed-off Setup Wizard and its release-specific instructions. Do not use an older test package for a production installation.

For the current source/project package workflow:

1. Extract the complete package to a permanent, writable folder on the Windows server PC.
2. Confirm that the bundled `runtime/node/node.exe` and `runtime/node/npm.cmd` files are present.
3. Run `INSTALL-INFINITY-SERVICES.bat` once. It checks the bundled Node.js 22 runtime and native SQLite dependency. It only downloads dependencies if the bundled dependencies are missing or invalid.
4. Run `START-INFINITY-SERVICES.bat`.
5. Keep the server window open while the system is in use. Press Ctrl+C in that window to stop the server cleanly.

Do not run the live system from a temporary Downloads folder or removable USB drive.

## 3. Complete the first-run application setup

Open `http://localhost:4000` on the server PC. On a new database, complete the one-time setup screen:

1. Enter the organization name in English and Arabic.
2. Choose English, Arabic, or bilingual default language.
3. Enter the organization's IANA timezone (for example, `Asia/Dubai`).
4. Set the business-day start time. Ticket numbering/day boundaries use this local time.
5. Set the administrator username and display name.
6. Create and confirm a strong password of at least 12 characters.
7. Select **Complete Setup & Open QueueSystem**.

This setup is one-time for that database. Store administrator credentials securely. Never send passwords to support or put them in scripts.

## 4. Connect reception, counter, and TV devices

1. On the server PC, open Command Prompt and run `ipconfig`.
2. Find the server PC's IPv4 address for the active private LAN adapter.
3. On each reception, counter, and TV device connected to the same LAN, open `http://SERVER-PC-IP:4000`.
4. Reserve the server PC's address in the router/DHCP configuration so it does not change.
5. If Windows Firewall blocks access, use the supplied `ALLOW-LAN-FIREWALL.bat` from the server PC and approve Administrator access. The rule is intended for the Private profile and local subnet only.

Never expose TCP port 4000 directly to the public internet. Default HTTP/WS mode is unencrypted. Configure a trusted TLS certificate before using the system on networks that require encrypted transport; see [HTTPS/WSS Setup](HTTPS-WSS-SETUP.md).

## 5. Daily queue operation

### Reception

1. Sign in with the Reception account.
2. Select the required service/category and language options shown on the kiosk.
3. Generate the ticket.
4. Print the ticket and confirm that the correct printer and paper size are selected.
5. Give the printed ticket to the visitor.

### Service counters

1. Sign in with the assigned staff account.
2. Confirm the correct counter assignment.
3. Use the queue controls to call the next eligible ticket.
4. Confirm the ticket and counter shown on screen.
5. Complete service or use the available transfer workflow when the visitor must move to another counter.

### TV display and announcements

Open the TV Display route at `/#/tv-display` on a browser connected to the server. The Windows startup watchdog is designed to start the server and reopen the TV display after Windows sign-in when its startup shortcut is installed.

The display supports live queue updates and English/Arabic announcements. Browser audio policies and the Windows audio device still need to be checked on the actual TV PC. If audio is blocked, interact with the browser/display once and verify the speaker and system volume.

## 6. Reports and exports

Use the Reports area to select the required business date and available service filters. The current report export endpoints provide PDF and Excel (.xlsx) files. Check the downloaded file before distributing it, especially when it contains customer or operational information.

Do not assume that an export includes every screen filter unless the selected date and service filter are reflected in the report.

## 7. Back up the database

1. Sign in with an account authorized to manage system settings.
2. Open System Settings and select **Create Backup Now**.
3. Confirm that the backup appears in the backup list.
4. Download the backup and copy it to a separate protected drive or secure storage location.
5. Back up `server/public/ads/` separately if the installation uses local advertisement media.

QueueSystem retains up to 30 database backup files in its managed backup directory. Retention is not a substitute for an off-device copy. A database backup does not include advertisement media or TLS certificate files.

## 8. Restore a database backup

Restoring replaces the current database. Schedule downtime and preserve the current database first.

1. Download or copy the selected `.db` backup into `server/data/backups/`.
2. Stop QueueSystem completely. If it is running in a server command window, press Ctrl+C. If the Windows watchdog is active, close the kiosk session and stop the watchdog/server before continuing.
3. Keep a separate copy of the current database and any other important customer files.
4. Run `RESTORE-INFINITY-BACKUP.bat`.
5. Enter the exact backup filename when prompted.
6. The restore process validates the backup and creates a safety copy of the current database before replacing it.
7. Start QueueSystem again and verify login, settings, counters, ticket history, and reports before returning to service.

Never replace the live database while the server is running. Do not delete the safety copy until the restored system has been checked.

## 9. Automatic startup and recovery

The Windows startup helper is intended for a dedicated QueueSystem PC. It checks the local server health endpoint, starts the server when it is not healthy, and launches the TV display in kiosk mode. It also retries when the managed server process exits or fails its health check.

For automatic recovery after a building power interruption, a local administrator must separately configure:
- BIOS/UEFI **Restore on AC Power Loss** to **Power On**.
- Windows automatic sign-in for a dedicated, physically secured Windows account, if unattended startup is required.
- Windows sleep settings so the server does not sleep while operating.
- A UPS where practical.

See [Windows Automatic Recovery Guide](WINDOWS-AUTO-RECOVERY-GUIDE.md). Hardware power recovery and Windows sign-in must be tested on the actual target PC.

## 10. Security and data handling

- Use a trusted private LAN; do not publish the server port to the internet.
- Configure trusted HTTPS/WSS certificates when encrypted LAN transport is required.
- Use unique staff accounts and strong administrator credentials.
- Restrict physical access to the server PC and its backup media.
- Keep backups away from the server so a disk failure does not destroy both the live database and its backups.
- The database backup does not include local ads, TLS certificates, or other files excluded from the database.

## 11. Support information to collect

When reporting a problem, provide the QueueSystem version/commit if available, Windows version, the exact time of the issue, the affected screen, and the exact error text. Do not send passwords, session tokens, private keys, or unredacted customer data.
