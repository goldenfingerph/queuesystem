@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo   INFINITY SERVICES - DATABASE RESTORE
echo ================================================
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
