@echo off
REM  Double-click launcher for DataBase Kavosh.
REM  Runs run.ps1 with a relaxed execution policy for this process only,
REM  so the user does not have to change any machine-wide Windows setting.

setlocal
cd /d "%~dp0"

where pwsh >nul 2>&1
if %ERRORLEVEL%==0 (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo The app stopped with an error. Press any key to close.
    pause >nul
)
endlocal
