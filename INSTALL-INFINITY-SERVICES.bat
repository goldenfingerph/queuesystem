@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo   INFINITY SERVICES - FIRST TIME INSTALL
echo ================================================

rem Use the self-contained Node.js 22 runtime shipped with QueueSystem.
set "NODE_HOME=%~dp0runtime\node"
if not exist "%NODE_HOME%\node.exe" (
  echo Bundled Node.js runtime is missing. Re-download and reinstall the complete Windows package.
  pause
  exit /b 1
)
set "PATH=%NODE_HOME%;%PATH%"

for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set NODE_MAJOR=%%V
if not "%NODE_MAJOR%"=="22" (
  echo Bundled Node.js 22.x is required. Current major version: %NODE_MAJOR%
  pause
  exit /b 1
)
if not exist "%NODE_HOME%\npm.cmd" (
  echo Bundled npm is missing. Reinstall QueueSystem using the complete Setup Wizard.
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
call npm.cmd ci
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
