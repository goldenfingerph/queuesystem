# INFINITY SERVICES — Docker Desktop on Windows 11 Pro

This deployment runs the React frontend and Express/WebSocket server in one Linux container. SQLite, database backups, uploaded advertisements, and the uploaded logo are stored in a Docker-managed named volume.

## Requirements

- Windows 11 Pro
- Docker Desktop for Windows, using the WSL 2 backend and Linux containers
- The repository checked out on the Windows server PC
- A trusted private LAN shared by the server, reception, counter, and TV devices

Do not place the live SQLite database or its WAL files on a Windows network share, NAS share, or synchronized folder. The database must remain inside the Docker-managed local volume and be opened only by this server container.

## First-time setup

1. Install and start Docker Desktop. Wait until it reports that the Docker Engine is running.
2. Open PowerShell in the repository folder.
3. Copy the sample environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Optional: edit `.env` and set `ADMIN_INITIAL_PASSWORD` to a strong password of at least 12 characters. Do this before the first container start only. If left blank, the application generates a one-time admin password and prints it in the container logs.
5. Build and start the service:

   ```powershell
   docker compose up -d --build
   ```

6. Check container status and health:

   ```powershell
   docker compose ps
   Invoke-RestMethod http://localhost:4000/health
   ```

7. If no initial admin password was configured, retrieve the one-time password immediately:

   ```powershell
   docker compose logs app
   ```

   Sign in as `admin`, save the password securely, and change it after login.

## Connect LAN devices

1. On the Windows server, run `ipconfig` and note its IPv4 address.
2. In an elevated PowerShell window, allow the app port from the local subnet on the Private profile:

   ```powershell
   New-NetFirewallRule -DisplayName "INFINITY Queue System (Docker)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4000 -Profile Private -RemoteAddress LocalSubnet
   ```

   If you changed `QUEUE_PORT` in `.env`, use that host port in the firewall rule instead.
3. On each reception, counter, and TV device on the same trusted LAN, open:

   `http://SERVER-PC-IP:4000`

Keep the server PC on the Private network profile and use a reserved/static DHCP address. Do not configure router port forwarding or expose this HTTP service to the public internet. This Compose setup does not provide HTTPS/TLS; use it only on a trusted LAN until a trusted TLS reverse proxy is configured.

## Normal operation

- View status: `docker compose ps`
- Follow logs: `docker compose logs -f app`
- Restart: `docker compose restart app`
- Stop: `docker compose down`
- Rebuild after updating code: `docker compose up -d --build`

Stopping or recreating the container does not remove the named `queue_data` volume. **Do not run `docker compose down --volumes` unless you intentionally want to delete the database, backups, advertisements, and logo.**

## Data and backups

The named volume mounted at `/data` contains:

- SQLite database: `/data/infinity.db`
- SQLite WAL/SHM files while the database is active
- Database backups: `/data/backups/`
- Uploaded advertisements: `/data/ads/`
- Uploaded logo: `/data/logo/`

Use the application's Administrator → System Settings → Create Backup Now function for database backups, then download a copy to a separate protected location. Database backups do not include uploaded video advertisements or the logo. Back up the Docker volume separately to preserve all media and database files together.

To identify the actual Docker volume name on this PC, run:

```powershell
docker volume ls
docker volume inspect <actual-volume-name>
```

Keep independent backups outside the server PC. Test a restore before relying on the deployment for daily operations.

## Troubleshooting

- Build logs: `docker compose logs --no-color app`
- Container health: `docker inspect --format='{{json .State.Health}}' infinity-queue-system`
- Port conflict: change `QUEUE_PORT` in `.env`, then run `docker compose up -d`.
- If the container is unhealthy, inspect logs before restarting repeatedly. Do not delete the volume as a troubleshooting shortcut.
