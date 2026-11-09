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
Name: "{autodesktop}\Start QueueSystem Server"; Filename: "{app}\START-INFINITY-SERVICES.bat"; WorkingDir: "{app}"; Tasks: desktopicon; IconFilename: "{sys}\imageres.dll"; IconIndex: 15

[Code]
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := False;
  if Exec(ExpandConstant('{sys}\cmd.exe'), '/C node --version | findstr /b /c:"v22." >nul', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Result := (ResultCode = 0);
  if not Result then
    MsgBox('QueueSystem requires Node.js 22.x (64-bit) installed and available in PATH. Install Node.js 22 LTS, then run this setup again.', mbError, MB_OK);
end;
