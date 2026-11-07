@echo off
setlocal

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Requesting Administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Adding a Private-network-only firewall rule for Infinity Services...
netsh advfirewall firewall add rule name="Infinity Services Queue Server" dir=in action=allow protocol=TCP localport=4000 profile=private remoteip=localsubnet
if errorlevel 1 (
  echo.
  echo Could not add the firewall rule. Check Windows Firewall settings.
  pause
  exit /b 1
)

echo.
echo Done. TCP port 4000 is allowed only from the local subnet on Private networks.
echo Do not change this rule to Public or expose the server to the internet.
pause
