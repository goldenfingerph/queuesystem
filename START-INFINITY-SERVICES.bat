@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo   INFINITY SERVICES - LOCAL LAN SERVER
echo ================================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Install Node.js 22 LTS first.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Project dependencies are not installed.
  echo Run INSTALL-INFINITY-SERVICES.bat first.
  pause
  exit /b 1
)

echo.
echo Starting the local server and building the app...
echo Keep this window open while the queue system is in use.
echo Press CTRL+C to stop the server safely.
echo.
call npm run start
echo.
echo The server has stopped.
pause
