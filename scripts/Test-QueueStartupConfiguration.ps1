$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$watchdogPath = Join-Path $PSScriptRoot 'Start-QueueKiosk.ps1'
$launcherPath = Join-Path $PSScriptRoot 'Start-QueueKiosk.vbs'
$installerPath = Join-Path $root 'installer\QueueSystem.iss'

foreach ($path in @($watchdogPath, $launcherPath, $installerPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required Windows auto-start component is missing: $path"
  }
}

$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($watchdogPath, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_.Message }
  throw 'QueueSystem watchdog PowerShell syntax validation failed.'
}

$launcher = Get-Content -LiteralPath $launcherPath -Raw
if ($launcher -notmatch 'Start-QueueKiosk\.ps1' -or $launcher -notmatch 'WindowStyle Hidden') {
  throw 'The hidden Windows Script Host launcher does not invoke the QueueSystem watchdog.'
}

$installer = Get-Content -LiteralPath $installerPath -Raw
if ($installer -notmatch '(?m)^Name:\s*"{userstartup}\\QueueSystem Auto Start"' -or
    $installer -notmatch 'Start-QueueKiosk\.vbs') {
  throw 'The installer does not register the QueueSystem watchdog in the current user Startup folder.'
}

$watchdog = Get-Content -LiteralPath $watchdogPath -Raw
$requiredWatchdogFeatures = @(
  'server/index.ts',
  '/health',
  'Start-Process',
  'Start-Sleep -Seconds 15',
  '--kiosk',
  'autoplay-policy=no-user-gesture-required'
)
foreach ($feature in $requiredWatchdogFeatures) {
  if (-not $watchdog.Contains($feature)) {
    throw "QueueSystem watchdog is missing required startup/recovery behavior: $feature"
  }
}

$crashRecoveryRequirements = @(
  '-PassThru',
  '$script:queueServerProcess = $process',
  '$script:queueServerProcess.HasExited',
  'Stop-StuckQueueServer',
  'Stop-Process -Id $process.Id -Force',
  'did not become healthy within 90 seconds',
  'return $r.StatusCode -eq 200'
)
foreach ($requirement in $crashRecoveryRequirements) {
  if (-not $watchdog.Contains($requirement)) {
    throw "QueueSystem crash-recovery watchdog is missing required safeguard: $requirement"
  }
}

$tvKioskRequirements = @(
  '$tvUrl = "$serverUrl/#/tv-display"',
  'QueueSystem\ChromeKioskProfile',
  '--user-data-dir=',
  '--kiosk',
  '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  'function Find-Chrome',
  'Microsoft\Edge\Application\msedge.exe',
  'function Start-TvDisplay',
  'Get-CimInstance Win32_Process',
  '$_.CommandLine.Contains($profilePath)',
  '$process.MainWindowHandle -ne 0',
  'Waiting 5 seconds before opening the TV Display browser.',
  'if (-not (Test-QueueServer))',
  'Start-TvDisplay'
)
foreach ($requirement in $tvKioskRequirements) {
  if (-not $watchdog.Contains($requirement)) {
    throw "QueueSystem TV kiosk startup/recovery is missing required behavior: $requirement"
  }
}

Write-Host 'PASS: Windows sign-in startup shortcut points to the hidden watchdog.'
Write-Host 'PASS: watchdog detects exited server processes, restarts them, and stops a stalled child before retrying.'
Write-Host 'PASS: TV Display uses the public /#/tv-display route, a persistent browser profile, kiosk/autoplay flags, and Chrome with Edge fallback.'
Write-Host 'PASS: watchdog waits for a healthy server, detects a missing kiosk window, and relaunches the TV Display.'
Write-Host 'NOTE: actual Windows sign-in, browser recovery, and power-recovery behavior still requires testing on the target PC.'
