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

Write-Host 'PASS: Windows sign-in startup shortcut points to the hidden watchdog.'
Write-Host 'PASS: watchdog can launch the server, check health, retry, and open the TV in kiosk mode.'
Write-Host 'NOTE: actual Windows sign-in and power-recovery behavior still requires testing on the target PC.'
