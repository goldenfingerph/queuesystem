#define AppName "QueueSystem"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #error SourceDir must be supplied by the build workflow.
#endif
#ifndef OutputDir
  #define OutputDir "dist-installer"
#endif

[Setup]
AppId={{B7F95A80-2F0D-4B77-9D45-4E4A0D4B63A1}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=GoldenFingerPH
DefaultDirName={localappdata}\Programs\QueueSystem
DefaultGroupName=QueueSystem
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=QueueSystem-Setup
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
Uninstallable=yes
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".env,.env.local,.git\*,.github\*,server\data\*,server\certs\*,server\public\ads\*,node_modules\.cache\*"

[Icons]
Name: "{autoprograms}\QueueSystem\Start QueueSystem Server"; Filename: "{app}\START-INFINITY-SERVICES.bat"; WorkingDir: "{app}"; IconFilename: "{sys}\imageres.dll"; IconIndex: 15
Name: "{autoprograms}\QueueSystem\Install or Repair Dependencies"; Filename: "{app}\INSTALL-INFINITY-SERVICES.bat"; WorkingDir: "{app}"; IconFilename: "{sys}\imageres.dll"; IconIndex: 15
Name: "{userstartup}\QueueSystem Auto Start"; Filename: "{app}\START-INFINITY-SERVICES.bat"; WorkingDir: "{app}"; IconFilename: "{sys}\imageres.dll"; IconIndex: 15
Name: "{autodesktop}\Start QueueSystem Server"; Filename: "{app}\START-INFINITY-SERVICES.bat"; WorkingDir: "{app}"; Tasks: desktopicon; IconFilename: "{sys}\imageres.dll"; IconIndex: 15

[Run]
; Install the official Windows Arabic (Saudi Arabia) TTS capability after the app files are installed.
; This requests UAC elevation and uses Windows servicing/Windows Update; failure does not roll back QueueSystem.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File \"{app}\\scripts\\Install-ArabicTTS.ps1\""; Verb: "runas"; Description: "Install Arabic text-to-speech voice (requires internet and Administrator approval)"; StatusMsg: "Installing Arabic speech voice from Windows..."; Flags: postinstall shellexec waituntilterminated
