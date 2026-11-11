$ErrorActionPreference = 'Stop'

$logDirectory = Join-Path $env:ProgramData 'QueueSystem\Logs'
$logPath = Join-Path $logDirectory 'Arabic-TTS-Install.log'

function Write-Log {
    param([string]$Message)
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Host $line
    try {
        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
        Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
    } catch {
        Write-Warning "Unable to write log: $($_.Exception.Message)"
    }
}

function Show-Message {
    param([string]$Message, [string]$Title, $Icon)
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($Message, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, $Icon)
}

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Administrator permission was not granted. Run the Arabic voice setup again as Administrator.'
    }

    Write-Log 'Starting Arabic (Saudi Arabia) Text-to-Speech setup.'
    Write-Log 'Windows will download the official language components through Windows servicing/Windows Update.'

    $capabilities = @(
        'Language.Basic~~~ar-SA~0.0.1.0',
        'Language.TextToSpeech~~~ar-SA~0.0.1.0'
    )

    foreach ($capability in $capabilities) {
        Write-Log "Checking Windows capability: $capability"
        $state = Get-WindowsCapability -Online -Name $capability
        if (-not $state) {
            throw "This Windows installation does not report the required capability: $capability"
        }

        if ($state.State -eq 'Installed') {
            Write-Log "$capability is already installed."
            continue
        }

        Write-Log "Installing $capability. This may take several minutes."
        $result = Add-WindowsCapability -Online -Name $capability -ErrorAction Stop
        if ($result.RestartNeeded) {
            Write-Log 'Windows reports that a restart may be required to complete the language component installation.'
        }

        $verified = Get-WindowsCapability -Online -Name $capability
        if ($verified.State -ne 'Installed') {
            throw "Windows did not report $capability as Installed (state: $($verified.State))."
        }
        Write-Log "$capability installed and verified."
    }

    Write-Log 'Arabic (Saudi Arabia) Text-to-Speech setup completed successfully.'
    Show-Message 'Arabic (Saudi Arabia) Text-to-Speech is installed. Close and reopen QueueSystem (and its browser) so the Arabic voice becomes available. English announcements will continue to play first, followed by Arabic.' 'QueueSystem - Arabic Voice Ready' ([System.Windows.Forms.MessageBoxIcon]::Information)
    exit 0
}
catch {
    $message = $_.Exception.Message
    Write-Log "ERROR: $message"
    Write-Log "See the full log at: $logPath"
    try { Start-Process 'ms-settings:regionlanguage' -ErrorAction SilentlyContinue } catch {}
    $nl = [Environment]::NewLine
    $failureMessage = 'QueueSystem was installed, but Windows could not install the Arabic voice automatically.' + $nl + $nl +
        "Reason: $message" + $nl + $nl +
        'Check your internet connection and Windows Update settings, then add Arabic (Saudi Arabia) with the Text-to-speech feature in Windows Settings. Installer log:' + $nl + $logPath
    Show-Message $failureMessage 'QueueSystem - Arabic Voice Setup Needs Attention' ([System.Windows.Forms.MessageBoxIcon]::Warning)
    exit 1
}