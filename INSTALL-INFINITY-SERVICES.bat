@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo   INFINITY SERVICES - FIRST TIME INSTALL
echo ================================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js 22 LTS, then run this file again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 22 (
  echo Node.js 22 or newer is required. Current major version: %NODE_MAJOR%
  pause
  exit /b 1
)

echo Installing the locked project dependencies...
echo Internet is required for this one-time installation.
call npm ci
if errorlevel 1 (
  echo.
  echo Installation failed. Check the internet connection and try again.
  pause
  exit /b 1
)

echo.
echo Installation completed. You can now use START-INFINITY-SERVICES.bat.
pause
