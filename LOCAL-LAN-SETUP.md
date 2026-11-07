# INFINITY SERVICES — Local LAN Setup

## Intended topology

- One Windows PC is the main server and owns the SQLite database.
- Reception, counter workstations, and TV browsers connect to the server PC over the same trusted local network.
- The server listens on port 4000 at `0.0.0.0`.
- Database: `server/data/infinity.db`
- Local advertisements: `server/public/ads/`
- Database backups: `server/data/backups/`

Do not put the SQLite database or its WAL files on a shared network drive. Only the server PC opens the live database.

## First setup on the Windows server

1. Install Node.js 22 LTS.
2. Download the **`restore-local-sqlite-lan` branch ZIP** from [this exact link](https://github.com/Infinityqueue/infinity-services-queue-management/archive/refs/heads/restore-local-sqlite-lan.zip), then extract it to a permanent folder on the server PC (for example, `C:\\InfinityServices`). Do not download the `main` branch. Do not run the system from a temporary Downloads folder or a USB drive.
3. Double-click `INSTALL-INFINITY-SERVICES.bat`. This installs the exact locked dependencies. Internet is needed only for this one-time package installation.
4. Double-click `START-INFINITY-SERVICES.bat` to build the app and start the local server. Keep its black command window open while the queue system is operating. Press `CTRL+C` in that window to stop the server safely.
5. On first database initialization, the application generates a random one-time admin password and prints it in the server console. Save that password immediately. Sign in with username `admin` and that password, then use **Change Password** at the bottom of the left sidebar.
6. Right-click `ALLOW-LAN-FIREWALL.bat` and choose **Run as administrator**. It adds a firewall rule for TCP port 4000 on the Private network and local subnet only. Do not expose port 4000 to the public internet.

If you prefer manual setup, open PowerShell in the project folder, run `npm ci`, then run `npm run start`.

The first `npm ci` requires internet access to download packages. Normal queue operation is local after dependencies and the project files are installed.

## Connect LAN devices

Find the server PC's IPv4 address using `ipconfig`. On each Reception, Counter, and TV browser, open:

`http://SERVER-PC-IP:4000`

Use a reserved/static DHCP address for the server PC so the address does not change. All devices must be on the same trusted LAN.

## Backup

Sign in as Administrator, open System Settings, and choose **Create Backup Now**. Backups are stored locally in `server/data/backups/`. Download a copy to a separate USB drive or another protected location regularly. Database backups do not include MP4 advertisements; back up `server/public/ads/` separately.

## Restore a database backup

**Stop the queue server first.** Never replace the live SQLite database while the server is running.

1. Copy the desired `infinity-backup-....db` file into `server/data/backups/`.
2. Stop the server by pressing `CTRL+C` in its black command window.
3. Double-click `RESTORE-INFINITY-BACKUP.bat` and enter the exact backup filename when asked.
4. The restore tool checks SQLite integrity, creates a safety backup of the current database, and then restores the selected file.
5. Start the server again by double-clicking `START-INFINITY-SERVICES.bat` and verify the dashboard and queue.

Do not rename a file to imitate the expected backup naming pattern. Keep the safety backup until the restored system has been verified.

## Important limitations before production use

- Test the complete workflow on the actual Windows server and all LAN clients before daily use.
- Browser printing and Zebra printer output depend on the installed printer driver and the specific Zebra model; verify ticket alignment and paper width (58/80 mm) on the actual printer.
- The database backup does not include MP4 files; copy the ads folder separately.
- The project is not intended to run its database from Vercel, Supabase, or browser storage.
