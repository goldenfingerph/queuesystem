@echo off
setlocal
cd /d "%~dp0"

rem Prefer the Node.js 22 runtime bundled with this package.
if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"

echo ================================================
echo   INFINITY SERVICES - DATABASE RESTORE
echo ================================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 is missing. Re-download the complete Windows package.
  pause
  exit /b 1
)
for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set NODE_MAJOR=%%V
if not "%NODE_MAJOR%"=="22" (
  echo Node.js 22.x is required. Current major version: %NODE_MAJOR%
  pause
  exit /b 1
)

echo IMPORTANT:
echo 1. Stop the queue server first (press CTRL+C in its server window).
echo 2. Put the backup .db file inside server\data\backups.
echo 3. Keep a separate copy of your current database before restoring.
echo.
set /p BACKUP_NAME=Enter the exact backup filename (infinity-backup-....db):
if "%BACKUP_NAME%"=="" (
  echo No filename entered. Nothing was restored.
  pause
  exit /b 1
)

echo.
echo Validating and restoring: %BACKUP_NAME%
call npm run db:restore -- "%BACKUP_NAME%"
if errorlevel 1 (
  echo.
  echo Restore did not complete. Read the error above.
  pause
  exit /b 1
)

echo.
echo Restore completed. Start the system again using START-INFINITY-SERVICES.bat.
pause
