@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo   INFINITY SERVICES - LOCAL LAN SERVER
echo ================================================

rem Always prefer the Node.js 22 runtime bundled with this installation.
set "NODE_HOME=%~dp0runtime\node"
if not exist "%NODE_HOME%\node.exe" (
  echo Bundled Node.js runtime is missing. Reinstall QueueSystem using the complete Setup Wizard.
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

if not exist "node_modules\tsx\dist\cli.mjs" (
  echo Project dependencies are not installed.
  echo Run INSTALL-INFINITY-SERVICES.bat first.
  pause
  exit /b 1
)

if exist "server\certs\server.crt" (
  if exist "server\certs\server.key" (
    set "TLS_CERT_FILE=%CD%\server\certs\server.crt"
    set "TLS_KEY_FILE=%CD%\server\certs\server.key"
    echo HTTPS/WSS certificate files found. Secure transport will be enabled.
  ) else (
    echo TLS private key is missing. HTTP/WS mode will be used.
    echo See HTTPS-WSS-SETUP.md to configure both certificate files.
  )
) else (
  echo HTTPS/WSS certificate files not found.
  echo HTTP/WS mode will be used. LAN traffic is not encrypted.
  echo See HTTPS-WSS-SETUP.md to configure a trusted certificate.
)

echo.
echo Starting the local server and building the app...
echo Keep this window open while the queue system is in use.
echo Press CTRL+C to stop the server safely.
echo.
call npm.cmd run start
echo.
echo The server has stopped.
pause
