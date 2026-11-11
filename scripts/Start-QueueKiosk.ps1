$ErrorActionPreference = 'Stop'
$installRoot = Split-Path -Parent $PSScriptRoot
$serverUrl = 'http://127.0.0.1:4000'
$tvUrl = "$serverUrl/#/tv-display"
$logDirectory = Join-Path $env:LOCALAPPDATA 'QueueSystem\Logs'
$logPath = Join-Path $logDirectory 'Kiosk-AutoStart.log'
$profilePath = Join-Path $env:LOCALAPPDATA 'QueueSystem\ChromeKioskProfile'
$nodePath = Join-Path $installRoot 'runtime\node\node.exe'
$tsxPath = Join-Path $installRoot 'node_modules\tsx\dist\cli.mjs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
function Write-Log([string]$Message) { Add-Content -LiteralPath $logPath -Value ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'),$Message) -Encoding UTF8 }
function Test-QueueServer {
  try { $r=Invoke-WebRequest -Uri "$serverUrl/health" -UseBasicParsing -TimeoutSec 3; return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500 } catch { return $false }
}
function Start-QueueServer {
  if (-not (Test-Path $nodePath) -or -not (Test-Path $tsxPath)) { Write-Log 'ERROR: Bundled Node.js runtime or tsx entry is missing.'; return }
  $stdout=Join-Path $logDirectory 'Server-stdout.log'; $stderr=Join-Path $logDirectory 'Server-stderr.log'
  $env:PATH="$(Split-Path -Parent $nodePath);$env:PATH"
  $cert=Join-Path $installRoot 'server\certs\server.crt'; $key=Join-Path $installRoot 'server\certs\server.key'
  if ((Test-Path $cert) -and (Test-Path $key)) { $env:TLS_CERT_FILE=$cert; $env:TLS_KEY_FILE=$key } else { Remove-Item Env:TLS_CERT_FILE,Env:TLS_KEY_FILE -ErrorAction SilentlyContinue }
  Write-Log 'Starting QueueSystem server process.'
  Start-Process -FilePath $nodePath -ArgumentList @($tsxPath,'server/index.ts') -WorkingDirectory $installRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
}
function Find-Chrome {
  $candidates=@(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path \${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  return $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
function Start-TvDisplay {
  $browser=Find-Chrome
  if (-not $browser) {
    $browser=Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'
    if (-not (Test-Path $browser)) { $browser=Join-Path \${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe' }
    if (-not (Test-Path $browser)) { Write-Log 'ERROR: Chrome and Edge were not found.'; return }
    Write-Log 'Chrome not found; using Edge kiosk fallback.'
  } else { Write-Log 'Opening TV Display in Google Chrome kiosk mode.' }
  New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
  $args=@('--kiosk','--no-first-run','--no-default-browser-check','--disable-session-crashed-bubble','--disable-infobars','--autoplay-policy=no-user-gesture-required',"--user-data-dir=$profilePath",$tvUrl)
  Start-Process -FilePath $browser -ArgumentList $args | Out-Null
}
Write-Log 'QueueSystem kiosk watchdog started after Windows sign-in.'
while ($true) {
  try {
    if (-not (Test-QueueServer)) {
      Write-Log 'Queue server is not responding; attempting to start it.'
      Start-QueueServer
      for ($i=0;$i -lt 45;$i++) { Start-Sleep -Seconds 2; if (Test-QueueServer) { break } }
      if (-not (Test-QueueServer)) { Write-Log 'WARNING: Server not healthy after 90 seconds; retrying.'; Start-Sleep -Seconds 15; continue }
      Write-Log 'Queue server health check passed.'
    }
    $kiosk=Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profilePath) } | Select-Object -First 1
    if (-not $kiosk) { Start-TvDisplay }
  } catch { Write-Log "Watchdog error: $($_.Exception.Message)" }
  Start-Sleep -Seconds 15
}
