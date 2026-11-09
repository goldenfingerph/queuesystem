@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo   INFINITY SERVICES - FIRST TIME INSTALL
echo ================================================

rem This project package uses the system-wide Node.js 22 installation.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 is missing. Install Node.js 22 LTS (64-bit) and try again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set NODE_MAJOR=%%V
if not "%NODE_MAJOR%"=="22" (
  echo Node.js 22.x is required. Current major version: %NODE_MAJOR%
  echo This application intentionally pins Node.js 22 for native SQLite compatibility.
  pause
  exit /b 1
)

echo Checking bundled Windows dependencies...
if exist "node_modules\tsx\dist\cli.mjs" (
  node -e "require('better-sqlite3');" >nul 2>nul
  if not errorlevel 1 (
    echo Bundled dependencies are present and the SQLite native module loaded.
    echo No dependency download is needed.
    goto :installed
  )
)

echo Bundled dependencies are missing or invalid.
echo Installing the locked project dependencies...
echo Internet is required only for this fallback installation.
call npm ci
if errorlevel 1 (
  echo.
  echo Installation failed. Check the internet connection and try again.
  pause
  exit /b 1
)

:installed
echo.
echo Installation completed. You can now use START-INFINITY-SERVICES.bat.
pause
