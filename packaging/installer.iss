; نصب‌کنندهٔ ویندوزی کاوشگر پایگاه داده — Inno Setup 6
;
; ساخت:  ISCC.exe packaging\installer.iss
; خروجی: packaging\output\KavoshDB-Setup-1.0.0.exe
;
; نصب در پوشهٔ کاربر (نه Program Files) انجام می‌شود تا نیازی به دسترسی
; مدیر نباشد: برنامه سروری محلی است و هیچ چیزی در سطح سیستم نمی‌نویسد.

#define AppName        "کاوشگر پایگاه داده"
#define AppNameEn      "DataBase Kavosh"
#define AppVersion     "1.0.0"
#define AppExe         "KavoshDB.exe"

[Setup]
AppId={{7F3C2A91-4D6E-4B18-9C55-1A7E0B2D8F43}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\{#AppNameEn}
DefaultGroupName={#AppNameEn}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=KavoshDB-Setup-{#AppVersion}
SetupIconFile=kavosh.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; نصب برای کاربر جاری: بدون درخواست دسترسی مدیر
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; رابط نصب راست‌به‌چپ می‌شود تا با خود برنامه هم‌خوان باشد
RightToLeft=yes

[Languages]
Name: "fa"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "ساخت میان‌بر روی میزکار"; GroupDescription: "میان‌برها:"

[Files]
Source: "..\dist\KavoshDB\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\حذف {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "اجرای {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; پوشهٔ کاری برنامه پاک می‌شود، ولی دانشی که کاربر ثبت کرده در
; %LOCALAPPDATA%\KavoshDB می‌ماند — حذف برنامه نباید کار کاربر را نابود کند.
Type: filesandordirs; Name: "{app}\_internal"
