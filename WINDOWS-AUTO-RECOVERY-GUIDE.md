# QueueSystem Windows automatic recovery setup

This one-time setup is for a dedicated QueueSystem server PC. The installer starts the server and TV Display automatically after Windows signs in. Windows automatic sign-in and firmware power recovery must be configured locally by an administrator.

## 1. Configure power recovery in BIOS/UEFI
1. Restart the server PC and enter BIOS/UEFI setup (commonly F2, Del, F10, or Esc; varies by manufacturer).
2. Find Restore on AC Power Loss, AC Power Recovery, After Power Failure, or similar.
3. Set it to Power On, then save and exit.
A UPS is recommended to protect the PC and SQLite database from repeated power cuts.

## 2. Configure Windows automatic sign-in
QueueSystem cannot safely configure this without the Windows account password. Never put the password in a QueueSystem script, installer, or support chat.
1. Create/use a dedicated standard Windows account for the display PC.
2. Set a strong account password. A Windows Hello PIN alone is not the account password required for automatic sign-in.
3. Use Microsoft's Sysinternals Autologon utility from the official Microsoft Learn/Sysinternals website. Run it as administrator and enter the dedicated account credentials locally.
4. Restart and verify Windows signs in without staff entering credentials.
Automatic sign-in reduces physical security. Anyone with physical access may reach the logged-in session. Use only on a physically secured PC and do not use an administrator account for kiosk sign-in.

## 3. Install QueueSystem and enable automatic TV mode
1. Install QueueSystem using the Setup Wizard.
2. Keep the default QueueSystem Auto Start Startup shortcut enabled.
3. Install Google Chrome. If Chrome is unavailable, the watchdog falls back to Microsoft Edge.
4. Sign in once and allow the watchdog to start.
5. Confirm http://127.0.0.1:4000/health responds and http://127.0.0.1:4000/#/tv-display opens full-screen.
The watchdog checks the local server every 15 seconds, restarts it if it stops, and reopens the TV browser if it closes.

## 4. Prevent sleep
In Windows Settings > System > Power, set sleep to Never while plugged in. Set the display timeout as appropriate for the TV.

## 5. Test recovery safely
1. Back up server\data\infinity.db outside the installation folder.
2. Close the TV browser and verify it reopens.
3. Stop the server and verify the watchdog restarts it.
4. Only then perform a controlled power recovery test, ideally with a UPS.

## Important limitations
- BIOS/UEFI AC recovery is a hardware setting and must be enabled manually.
- Windows automatic sign-in must be configured locally by an administrator.
- The installer never collects or stores the Windows password.
- Actual power-loss recovery must be tested on the target PC; a GitHub build cannot prove hardware behavior.
