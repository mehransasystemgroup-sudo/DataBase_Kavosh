; نصب‌کنندهٔ ویندوزی کاوشگر پایگاه داده — NSIS 3
;
; ساخت:  makensis packaging/installer.nsi
; خروجی: packaging/KavoshDB-Setup-1.0.0.exe
;
; نصب برای کاربر جاری انجام می‌شود (بدون UAC): برنامه سروری محلی است، چیزی در
; سطح سیستم نمی‌نویسد و دانش کاربر در %LOCALAPPDATA%\KavoshDB می‌ماند. همین
; باعث می‌شود روی رایانه‌های سازمانی که کاربر دسترسی مدیر ندارد هم نصب شود.

Unicode true
ManifestDPIAware true

!include "MUI2.nsh"
!include "FileFunc.nsh"   ; برای ${GetSize} هنگام ثبت حجم برنامه
!include "x64.nsh"        ; برای بررسی ۶۴ بیتی بودن ویندوز

!define APP_NAME     "کاوشگر پایگاه داده"
!define APP_NAME_EN  "DataBase Kavosh"
!define APP_VERSION  "1.0.0"
!define APP_EXE      "KavoshDB.exe"
!define APP_KEY      "DataBaseKavosh"
!define DATA_DIR     "$LOCALAPPDATA\KavoshDB"

!ifndef SRCDIR
  !define SRCDIR "..\dist\KavoshDB"
!endif

Name "${APP_NAME}"
; خروجی کنار خودِ اسکریپت ساخته می‌شود، نه در زیرپوشه: NSIS پوشهٔ ناموجود
; را نمی‌سازد و یک کلون تازه زیرپوشه‌ای ندارد، پس ساخت بی‌مقدمه شکست می‌خورد.
OutFile "KavoshDB-Setup-${APP_VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME_EN}"
InstallDirRegKey HKCU "Software\${APP_KEY}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName"     "${APP_NAME_EN}"
VIAddVersionKey /LANG=1033 "FileDescription" "${APP_NAME_EN} Setup"
VIAddVersionKey /LANG=1033 "FileVersion"     "${APP_VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductVersion"  "${APP_VERSION}.0"
VIAddVersionKey /LANG=1033 "CompanyName"     "${APP_NAME_EN}"
VIAddVersionKey /LANG=1033 "LegalCopyright"  "${APP_NAME_EN}"

!define MUI_ICON   "kavosh.ico"
!define MUI_UNICON "kavosh.ico"
!define MUI_ABORTWARNING

; صفحهٔ پایانی: تیک «اجرای برنامه» تا کاربر برای دیدن نتیجه دنبال میان‌بر نگردد
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "اجرای ${APP_NAME}"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; فارسی، پس رابط نصب هم مثل خود برنامه راست‌به‌چپ می‌شود
!insertmacro MUI_LANGUAGE "Farsi"

; ------------------------------------------------------------------ نصب

; خودِ نصب‌کننده ۳۲ بیتی است — همان چیزی که تقریباً هر نصب‌کنندهٔ ویندوزی هست:
; روی هر ویندوزی بالا می‌آید و به هیچ ابزار ساخت خاصی وابسته نیست. اما برنامهٔ
; نصب‌شونده ۶۴ بیتی است، پس اگر ویندوز ۳۲ بیتی باشد باید صریح بگوییم، نه اینکه
; نصب تمام شود و بعد برنامه اجرا نشود.
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "این برنامه ویندوز ۶۴ بیتی می‌خواهد و روی این سیستم اجرا نمی‌شود."
    Abort
  ${EndIf}
FunctionEnd

; بستن نسخهٔ در حال اجرا: بدون این کار، فایل‌های قفل‌شده جایگزین نمی‌شوند و
; نصب نیمه‌کاره می‌ماند.
!macro CloseRunningApp
  nsExec::Exec 'taskkill /F /IM "${APP_EXE}"'
  Pop $0
!macroend

Section "برنامه (الزامی)" SecApp
  SectionIn RO
  !insertmacro CloseRunningApp

  ; پوشهٔ کتابخانه‌ها از نصب قبلی پاک می‌شود تا فایل‌های قدیمی با جدید قاطی نشوند
  RMDir /r "$INSTDIR\_internal"

  SetOutPath "$INSTDIR"
  File /r "${SRCDIR}\*"

  WriteRegStr HKCU "Software\${APP_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\${APP_KEY}" "Version"    "${APP_VERSION}"

  CreateDirectory "$SMPROGRAMS\${APP_NAME_EN}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME_EN}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortCut "$SMPROGRAMS\${APP_NAME_EN}\حذف ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; ثبت در «برنامه‌ها و ویژگی‌ها»ی ویندوز
  !define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_KEY}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr   HKCU "${UNINST_KEY}" "Publisher"       "${APP_NAME_EN}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayIcon"     "$INSTDIR\${APP_EXE}"
  WriteRegStr   HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "میان‌بر روی میزکار" SecDesktop
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
SectionEnd

LangString DESC_SecApp     ${LANG_FARSI} "خود برنامه به‌همراه پایگاه دانش و رابط کاربری."
LangString DESC_SecDesktop ${LANG_FARSI} "یک میان‌بر روی میزکار ساخته می‌شود."

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp}     $(DESC_SecApp)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} $(DESC_SecDesktop)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ------------------------------------------------------------------ حذف

Section "Uninstall"
  !insertmacro CloseRunningApp

  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME_EN}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME_EN}\حذف ${APP_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${APP_NAME_EN}"

  RMDir /r "$INSTDIR\_internal"
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_KEY}"
  DeleteRegKey HKCU "Software\${APP_KEY}"

  ; دانشی که کاربر ثبت کرده جدا از برنامه است؛ حذف برنامه نباید کار او را
  ; نابود کند، پس فقط با تأیید صریح پاک می‌شود. در حذف بی‌صدا (مثلاً از طریق
  ; QuietUninstallString یا ابزارهای سازمانی) پرسشی نمایش داده نمی‌شود و داده
  ; دست‌نخورده می‌ماند — وگرنه نصب‌کننده پشت یک پنجرهٔ نامرئی قفل می‌شد.
  IfSilent done
  IfFileExists "${DATA_DIR}\*.*" 0 done
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "دانش و ایندکسی که در این رایانه ثبت شده هم پاک شود؟$\n$\nاگر «خیر» را بزنید، با نصب دوبارهٔ برنامه همه‌چیز سر جایش است." \
    IDNO done
  RMDir /r "${DATA_DIR}"
done:
SectionEnd
