# Docker Desktop setup — Windows 11 Pro

This deployment runs the React production build and Express/SQLite server in one
Linux container. Docker Desktop must use **Linux containers**.

## Requirements

- Windows 11 Pro with current Docker Desktop (WSL 2 backend).
- Docker Desktop started and showing **Engine running**.
- A local project checkout with the committed `package-lock.json`.
- Internet access for the first image build.

## First start

1. Install/start Docker Desktop and allow its WSL 2 setup to finish.
2. Open PowerShell in the project folder.
3. Copy the example environment file:
   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```
4. Optionally set `ADMIN_INITIAL_PASSWORD` in `.env` to a strong password of at least 12 characters. If left blank, the application generates a one-time password on first database initialization.
5. Build and start:
   ```powershell
   docker compose up -d --build
   ```
6. Check startup and health:
   ```powershell
   docker compose ps
   docker compose logs queuesystem
   Invoke-RestMethod http://localhost:4000/health
   ```
7. If no initial password was configured, copy the one-time password from the first-run server log. Do not delete the database volume after initialization.
8. Open `http://localhost:4000` on the server PC.

## Connect reception, counter, and TV devices

Find the server PC's LAN IPv4 address with `ipconfig`. On other devices on the
same trusted LAN, open `http://SERVER-PC-IP:4000`.

If Windows Firewall prompts, allow Docker Desktop / port 4000 only on the
**Private** network. If needed, create an inbound TCP 4000 rule scoped to the
local subnet and Private profile. Do not expose this service directly to the
public internet or configure router port forwarding.

Reserve the server PC's LAN address in DHCP so it does not change. Test every
workstation, TV browser, and receipt printer on the actual LAN before daily use.

## Persistent data

Docker Compose creates four named volumes:

- `queue_data`: live SQLite database and its WAL files.
- `queue_backups`: database backup files.
- `queue_ads`: uploaded advertisement videos.
- `queue_logo`: uploaded logo images.

These volumes survive container rebuilds and `docker compose down`. **Never**
use `docker compose down -v` on a live installation; `-v` deletes the
persistent volumes and their data. The SQLite database stays inside the
container's local Docker volume, not on a network share.

## Routine commands

```powershell
docker compose ps
docker compose logs -f queuesystem
docker compose restart queuesystem
docker compose pull
docker compose up -d --build
```

Keep a separate off-PC backup of the database and uploaded media. Application
database backups do not include advertisement videos or logo images. Before
updating, create a database backup in the admin UI and separately export the
Docker volumes. A Docker volume is not a substitute for an off-device backup.

## Stop safely

```powershell
docker compose down
```

This stops/removes the container and network but preserves named volumes. Do
not add `-v` unless you intentionally want to permanently erase all stored
application data.

## Important

- Port 4000 is published on the Windows host; restrict it to the trusted LAN
  using Windows Firewall. Do not expose it to the internet.
- Docker Desktop and the Windows server PC must remain running for clients to
  use the queue system.
- Browser printing and Zebra printer behavior still require physical testing.
- Keep the `.env` file private; never commit it.
