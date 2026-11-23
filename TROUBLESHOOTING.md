# QueueSystem Troubleshooting Guide

Use this guide for common Windows and LAN issues. Record the exact error before changing settings. Do not delete the database, backup folder, certificates, or customer media as a troubleshooting shortcut.

## Server does not start

1. Confirm that you are running the launch script from the extracted QueueSystem installation folder.
2. Confirm that `runtime/node/node.exe`, `runtime/node/npm.cmd`, and `node_modules/tsx/dist/cli.mjs` exist.
3. Run `INSTALL-INFINITY-SERVICES.bat` if the dependency check reports missing or invalid dependencies.
4. Run `START-INFINITY-SERVICES.bat` again and read the first error shown in the console.
5. Confirm that TCP port 4000 is not already used by another application.
6. Check that the installation folder is writable by the Windows account running QueueSystem.

The bundled runtime must be Node.js 22.x. Do not replace it with an unrelated Node.js version.

## The browser cannot open QueueSystem

- On the server PC, test `http://localhost:4000`.
- On a LAN device, use the server PC's current IPv4 address: `http://SERVER-PC-IP:4000`.
- Confirm that both devices are on the same trusted LAN.
- Check the active network profile in Windows. The supplied firewall helper creates a Private-profile, local-subnet rule for TCP 4000.
- Check whether another device or application is already using port 4000.
- If the server PC's IP address changed, update the address used by the client devices and reserve the server address in DHCP.

Do not open the port to Public networks or the public internet.

## Browser shows HTTP/WS or TLS warning

If `server/certs/server.crt` and `server/certs/server.key` are not both configured, the supplied launcher uses HTTP/WS and the server warns that LAN traffic is not encrypted. This is expected fallback behavior, not proof that HTTPS is enabled.

To use HTTPS/WSS, configure a valid certificate and matching private key, ensure clients trust the certificate, and follow [HTTPS/WSS Setup](HTTPS-WSS-SETUP.md). Do not send the private key to support.

## Reception, counter, or TV screen is stale

1. Confirm that the server is running and `http://SERVER-PC-IP:4000/health` responds.
2. Refresh the affected browser tab.
3. Confirm that the device still has LAN access to the server.
4. If only one device is affected, close and reopen that browser.
5. Do not restore the database to solve a temporary browser or network issue.

## Ticket printer does not print or alignment is wrong

- Confirm that Windows can print a test page using the intended printer.
- Select the correct printer in the browser print dialog.
- Check the printer driver, paper width (for example 58 mm or 80 mm), orientation, scaling, and margins.
- Print a test ticket and adjust the printer/driver configuration.
- Printer output depends on the actual printer model and driver; validate it on the target device before production use.

## English or Arabic voice is missing

- Check Windows master volume, output device, TV/monitor audio output, and browser tab mute state.
- Interact with the TV browser once if its autoplay policy blocks audio.
- Confirm that the TV Display voice control is enabled.
- If using Windows speech synthesis, install the Arabic (Saudi Arabia) Text-to-Speech capability through the installer prompt or Windows language settings. Administrator approval and internet/Windows Update access may be required.
- Close and reopen the browser after installing a Windows voice component.
- Confirm that the supplied Arabic audio assets remain in the application package.

## Automatic TV startup does not run

- Confirm that the Windows account has signed in; the Startup shortcut runs after sign-in, not before it.
- Confirm that the QueueSystem Auto Start shortcut is present in the Windows Startup folder.
- Confirm that Google Chrome or Microsoft Edge is installed.
- Check `%LOCALAPPDATA%\QueueSystem\Logs\Kiosk-AutoStart.log`, `Server-stdout.log`, and `Server-stderr.log`.
- Confirm that port 4000 is available and the local health endpoint responds.
- Restart the Windows session and observe whether the TV browser opens.

The startup watchdog does not configure BIOS power recovery or Windows automatic sign-in. Those are separate local administrator tasks.

## Backup creation fails or no backup appears

- Confirm that the signed-in account has permission to manage backups.
- Confirm that the installation's database and backup directories are writable and that the disk has free space.
- Check the application response/error and server console output.
- Do not manually delete database WAL/SHM files while the server is running.
- Download a completed backup and store an off-device copy.

## Restore fails

1. Stop the server and the Windows startup watchdog before restoring.
2. Confirm that the selected backup file is inside `server/data/backups/`.
3. Enter the exact filename, including the `.db` extension.
4. Do not rename arbitrary files to imitate a backup filename.
5. Keep the current database and safety backup untouched.
6. If validation fails, do not force-copy the file over the live database. Restore a known-good backup or contact support with the error text.

## Arabic or English text appears incorrectly in PDF/Excel

- Open the downloaded file in a current PDF reader or spreadsheet application.
- Confirm that the report contains the expected date and service filter.
- For Arabic text, use an application with Arabic shaping and right-to-left language support.
- Do not edit the live database to correct an export display issue.

## Collecting logs for support

Collect only the relevant error lines and approximate time:
- The server command window output.
- `%LOCALAPPDATA%\QueueSystem\Logs\Kiosk-AutoStart.log`.
- `%LOCALAPPDATA%\QueueSystem\Logs\Server-stdout.log`.
- `%LOCALAPPDATA%\QueueSystem\Logs\Server-stderr.log`.
- `%ProgramData%\QueueSystem\Logs\Arabic-TTS-Install.log`, if Arabic voice installation failed.

Redact usernames, customer details, IP addresses if sensitive, tokens, passwords, and any private-key content. Never send `.env` files or TLS private keys.
