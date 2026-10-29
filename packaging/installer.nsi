; نصب‌کنندهٔ ویندوزی کاوشگر پایگاه داده — NSIS 3
;
; ساخت:  makensis packaging/installer.nsi
; خروجی: packaging/KavoshDB-Setup-3.7.0.exe
;
; نصب برای کاربر جاری انجام می‌شود (بدون UAC): برنامه سروری محلی است، چیزی در
; سطح سیستم نمی‌نویسد و دانش کاربر در %LOCALAPPDATA%\KavoshDB می‌ماند. همین
; باعث می‌شود روی رایانه‌های سازمانی که کاربر دسترسی مدیر ندارد هم نصب شود.

Unicode true
ManifestDPIAware true

!include "MUI2.nsh"
!include "FileFunc.nsh"   ; برای ${GetSize} هنگام ثبت حجم برنامه
!include "x64.nsh"        ; برای بررسی ۶۴ بیتی بودن ویندوز
!include "WinVer.nsh"     ; برای بررسی نسخهٔ ویندوز

!define APP_NAME     "کاوشگر پایگاه داده"
!define APP_NAME_EN  "DataBase Kavosh"
!define APP_VERSION  "3.7.0"
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
  ; پایتون ۳.۱۱ روی ویندوز قدیمی‌تر از ۸.۱ بالا نمی‌آید. بدون این شرط، نصب
  ; بی‌عیب تمام می‌شود و بعد برنامه بی‌هیچ پیامی اجرا نمی‌شود — بدترین حالت
  ; ممکن برای کاربر، چون هیچ سرنخی ندارد.
  ${IfNot} ${AtLeastWin8.1}
    MessageBox MB_ICONSTOP "این برنامه دست‌کم ویندوز ۸.۱ می‌خواهد و روی این نسخه از ویندوز اجرا نمی‌شود."
    Abort
  ${EndIf}
FunctionEnd

; بستن نسخهٔ در حال اجرا: بدون این کار، فایل‌های قفل‌شده جایگزین نمی‌شوند و
; نصب نیمه‌کاره می‌ماند.
;
; /T فرزندها را هم می‌بندد، و مکث پس از آن لازم است: ویندوز دستگیره‌های فایل
; را چند لحظه پس از پایان فرایند آزاد می‌کند، نه بلافاصله.
!macro CloseRunningApp
  nsExec::Exec 'taskkill /F /T /IM "${APP_EXE}"'
  Pop $0
  Sleep 1200
!macroend

Section "برنامه (الزامی)" SecApp
  SectionIn RO
  !insertmacro CloseRunningApp

  ; ── پاک‌کردن کتابخانه‌های نصب قبلی، با اطمینان از انجام‌شدنش ──
  ;
  ; این‌جا جایی است که به‌روزرسانی روی نصب قبلی می‌شکست. RMDir اگر فایلی قفل
  ; باشد بی‌صدا رد می‌شود و نصب ادامه پیدا می‌کند؛ نتیجه پوشه‌ای است با
  ; ترکیبی از کتابخانه‌های قدیمی و تازه، که بوت‌لودر PyInstaller آن را
  ; نمی‌پذیرد — برنامه نصب می‌شود ولی اجرا نمی‌شود، و کاربر فقط یک برق
  ; کوتاه می‌بیند. پس دیگر بی‌صدا رد نمی‌شویم: چند بار تلاش می‌کنیم و اگر
  ; نشد، صریح می‌گوییم به‌جای اینکه نصبی خراب تحویل بدهیم.
  StrCpy $R0 0
  ${Do}
    RMDir /r "$INSTDIR\_internal"
    ${IfNot} ${FileExists} "$INSTDIR\_internal\*.*"
      ${ExitDo}
    ${EndIf}
    IntOp $R0 $R0 + 1
    ${If} $R0 >= 5
      DetailPrint "پاک‌کردن $INSTDIR\_internal ممکن نشد."
      ${IfNot} ${Silent}
        MessageBox MB_ICONSTOP "فایل‌های نسخهٔ قبلی در دست برنامهٔ دیگری است و جایگزین نمی‌شوند.$\n$\nلطفاً «کاوشگر پایگاه داده» را ببندید (و اگر باز است، پنجرهٔ مرورگرش را هم) و دوباره نصب کنید."
      ${EndIf}
      SetErrorLevel 2
      Abort "نصب انجام نشد: فایل‌های نسخهٔ قبلی قفل بودند."
    ${EndIf}
    DetailPrint "فایل‌های نسخهٔ قبلی هنوز در دسترس‌اند؛ تلاش دوباره…"
    Sleep 1500
    !insertmacro CloseRunningApp
  ${Loop}

  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r "${SRCDIR}\*"
  ; راه تشخیص وقتی برنامه بی‌صدا بالا نمی‌آید — پنجره‌اش باز می‌ماند
  File "diagnose.cmd"

  WriteRegStr HKCU "Software\${APP_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\${APP_KEY}" "Version"    "${APP_VERSION}"

  CreateDirectory "$SMPROGRAMS\${APP_NAME_EN}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME_EN}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortCut "$SMPROGRAMS\${APP_NAME_EN}\تشخیص مشکل.lnk" "$INSTDIR\diagnose.cmd" "" "$INSTDIR\${APP_EXE}" 0
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
  Delete "$SMPROGRAMS\${APP_NAME_EN}\تشخیص مشکل.lnk"
  Delete "$SMPROGRAMS\${APP_NAME_EN}\حذف ${APP_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${APP_NAME_EN}"

  RMDir /r "$INSTDIR\_internal"
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\diagnose.cmd"
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
