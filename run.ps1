<#
.SYNOPSIS
    راه‌انداز کاوشگر پایگاه داده روی ویندوز.

.DESCRIPTION
    همه‌چیز را از صفر آماده و اجرا می‌کند: محیط پایتون، وابستگی‌ها، بیلد
    فرانت‌اند، ایندکس جست‌وجو، و سپس سرور روی یک پورت. بار اول چند دقیقه
    طول می‌کشد؛ دفعات بعد چند ثانیه، چون هر گام فقط در صورت نیاز اجرا می‌شود.

.PARAMETER Port
    پورت سرور. پیش‌فرض ۸۳۲۱.

.PARAMETER Dev
    حالت توسعه: بک‌اند و سرور توسعهٔ Vite جدا اجرا می‌شوند و تغییر کد
    بی‌درنگ در مرورگر دیده می‌شود.

.PARAMETER Rebuild
    ایندکس جست‌وجو و بیلد فرانت‌اند را دوباره می‌سازد، حتی اگر موجود باشند.

.PARAMETER NoBrowser
    مرورگر را خودکار باز نمی‌کند.

.EXAMPLE
    .\run.ps1
    نصب (در صورت نیاز) و اجرا روی http://127.0.0.1:8321

.EXAMPLE
    .\run.ps1 -Port 9000 -Rebuild
    ساخت دوبارهٔ ایندکس و بیلد، سپس اجرا روی پورت ۹۰۰۰

.EXAMPLE
    .\run.ps1 -Dev
    حالت توسعه روی http://127.0.0.1:3000

.NOTES
    اگر ویندوز اجرای اسکریپت را مسدود کرد:
        powershell -ExecutionPolicy Bypass -File .\run.ps1
    یا فایل Start-Kavosh.cmd را دوبار کلیک کنید.
#>

[CmdletBinding()]
param(
    [int]$Port = 8321,
    [switch]$Dev,
    [switch]$Rebuild,
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# خروجی فارسی در کنسول ویندوز بدون این تنظیم به‌هم می‌ریزد
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# در اجرای معمول با -File مقدار دارد، ولی اگر اسکریپت dot-source شود خالی
# می‌ماند و Join-Path خطای گنگ «Path argument was null» می‌دهد.
$Root        = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$BackendDir  = Join-Path $Root 'backend'
$FrontendDir = Join-Path $Root 'frontend'
$VenvDir     = Join-Path $BackendDir '.venv'
$VenvPython  = Join-Path $VenvDir 'Scripts\python.exe'
$IndexFile   = Join-Path $BackendDir 'index\kb.sqlite'
$StaticDir   = Join-Path $BackendDir 'static'
$DistDir     = Join-Path $FrontendDir 'dist'

# ─────────────────────────── کمکی‌ها ───────────────────────────

function Write-Step  { param([string]$Text) Write-Host "`n▸ $Text" -ForegroundColor Green }
function Write-Info  { param([string]$Text) Write-Host "  $Text" -ForegroundColor DarkGray }
function Write-Warn2 { param([string]$Text) Write-Host "  ! $Text" -ForegroundColor Yellow }

function Stop-WithError {
    param([string]$Message, [string]$Hint)
    Write-Host "`n✖ $Message" -ForegroundColor Red
    if ($Hint) { Write-Host "  $Hint" -ForegroundColor Yellow }
    Write-Host ''
    exit 1
}

<#
    اجرای یک برنامهٔ بیرونی با کنترل خطا.

    چرا لازم است: $ErrorActionPreference روی کد خروجِ برنامه‌های بیرونی اثر
    ندارد، پس بدون بررسی صریح $LASTEXITCODE اسکریپت پس از یک نصبِ شکست‌خورده
    با خوش‌بینی ادامه می‌دهد و خطای گیج‌کننده‌ای در گام بعدی می‌دهد.
#>
function Invoke-External {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $Root,
        [string]$FailureMessage = 'اجرای دستور ناموفق بود.'
    )
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            Stop-WithError -Message $FailureMessage -Hint "کد خروج: $LASTEXITCODE  ·  دستور: $FilePath $($Arguments -join ' ')"
        }
    }
    finally { Pop-Location }
}

<#
    یافتن پایتون ۳.۱۰ یا بالاتر.

    روی ویندوز راه‌انداز `py` مرجع‌ترین گزینه است، ولی روی همهٔ نصب‌ها وجود
    ندارد؛ پس به `python` هم برمی‌گردیم. نسخهٔ نصب‌های فروشگاه مایکروسافت که
    فقط یک میان‌بر تبلیغاتی‌اند، اجرا می‌شوند ولی نسخه برنمی‌گردانند و همین‌جا
    رد می‌شوند.
#>
function Find-Python {
    $candidates = @(
        @{ Path = 'py';     Args = @('-3') },
        @{ Path = 'python'; Args = @() },
        @{ Path = 'python3'; Args = @() }
    )
    foreach ($c in $candidates) {
        $cmd = Get-Command $c.Path -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        try {
            $out = & $c.Path @($c.Args + '--version') 2>&1 | Out-String
        } catch { continue }
        if ($out -match '(\d+)\.(\d+)\.(\d+)') {
            $major = [int]$Matches[1]; $minor = [int]$Matches[2]
            if ($major -eq 3 -and $minor -ge 10) {
                return [pscustomobject]@{
                    Path    = $c.Path
                    Args    = $c.Args
                    Version = "$major.$minor.$($Matches[3])"
                }
            }
        }
    }
    return $null
}

function Find-Npm {
    foreach ($name in @('npm.cmd', 'npm')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    return $null
}

function Test-PortInUse {
    param([int]$Number)
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Number)
        $listener.Start(); $listener.Stop()
        return $false
    } catch { return $true }
}

# ─────────────────────────── بررسی پیش‌نیازها ───────────────────────────

Write-Host ''
Write-Host '  کاوشگر پایگاه داده' -ForegroundColor Green
Write-Host '  DataBase Kavosh' -ForegroundColor DarkGray
Write-Host '  ─────────────────────────────' -ForegroundColor DarkGray

if (-not (Test-Path $BackendDir) -or -not (Test-Path $FrontendDir)) {
    Stop-WithError -Message 'پوشه‌های backend و frontend پیدا نشد.' `
                   -Hint 'این اسکریپت باید در ریشهٔ همان مخزن اجرا شود.'
}

Write-Step 'بررسی پیش‌نیازها'

$python = Find-Python
if (-not $python) {
    Stop-WithError -Message 'پایتون ۳٫۱۰ یا بالاتر پیدا نشد.' `
                   -Hint 'از python.org نصب کنید و هنگام نصب گزینهٔ «Add python.exe to PATH» را تیک بزنید.'
}
Write-Info "پایتون $($python.Version)"

# پیش از هر کار سنگینی بررسی می‌شود: کاربر نباید چند دقیقه منتظر بیلد بماند
# و بعد بفهمد پورت اشغال است.
if (Test-PortInUse -Number $Port) {
    Stop-WithError -Message "پورت $Port در حال استفاده است." `
                   -Hint "پورت دیگری بدهید، مثلاً:  .\run.ps1 -Port 8322"
}
Write-Info "پورت $Port آزاد است"

$npm = $null
if ($Dev -or $Rebuild -or -not (Test-Path $DistDir)) {
    $npm = Find-Npm
    if (-not $npm) {
        Stop-WithError -Message 'Node.js پیدا نشد (برای ساخت رابط کاربری لازم است).' `
                       -Hint 'نسخهٔ LTS را از nodejs.org نصب کنید، پنجرهٔ PowerShell را ببندید و دوباره باز کنید.'
    }
    $nodeVersion = (& node --version 2>&1 | Out-String).Trim()
    Write-Info "Node.js $nodeVersion"
} else {
    Write-Info 'بیلد فرانت‌اند از قبل موجود است — Node.js لازم نیست.'
}

# ─────────────────────────── بک‌اند ───────────────────────────

Write-Step 'آماده‌سازی محیط پایتون'

if (-not (Test-Path $VenvPython)) {
    Write-Info 'ساخت محیط مجازی…'
    Invoke-External -FilePath $python.Path -Arguments ($python.Args + @('-m', 'venv', $VenvDir)) `
                    -FailureMessage 'ساخت محیط مجازی پایتون ناموفق بود.'
} else {
    Write-Info 'محیط مجازی از قبل ساخته شده.'
}

if (-not (Test-Path $VenvPython)) {
    Stop-WithError -Message "پایتونِ محیط مجازی ساخته نشد: $VenvPython"
}

# نصب فقط وقتی که واقعاً لازم است — بررسی سریع‌تر از اجرای همیشگی pip است
$needInstall = $true
try {
    & $VenvPython -c 'import fastapi, uvicorn, yaml' 2>$null
    if ($LASTEXITCODE -eq 0) { $needInstall = $false }
} catch { $needInstall = $true }

if ($needInstall) {
    Write-Info 'نصب وابستگی‌های بک‌اند…'
    Invoke-External -FilePath $VenvPython -Arguments @('-m', 'pip', 'install', '--quiet', '--upgrade', 'pip') `
                    -FailureMessage 'به‌روزرسانی pip ناموفق بود.'
    Invoke-External -FilePath $VenvPython `
                    -Arguments @('-m', 'pip', 'install', '--quiet', '-r', (Join-Path $BackendDir 'requirements.txt')) `
                    -FailureMessage 'نصب وابستگی‌های بک‌اند ناموفق بود.'
} else {
    Write-Info 'وابستگی‌های بک‌اند از قبل نصب‌اند.'
}

# ─────────────────────────── ایندکس دانش ───────────────────────────

Write-Step 'ایندکس جست‌وجو'

if ($Rebuild -and (Test-Path $IndexFile)) {
    Write-Info 'حذف ایندکس قبلی برای ساخت دوباره…'
    Remove-Item $IndexFile -Force
}

if (-not (Test-Path $IndexFile)) {
    Write-Info 'ساخت ایندکس از kb/ — این گام یک‌بار انجام می‌شود و کمی طول می‌کشد…'
    Invoke-External -FilePath $VenvPython `
                    -Arguments @('scripts/build_index.py', '--kb', 'kb', '--out', 'index/kb.sqlite', '--instance', 'instances/live') `
                    -WorkingDirectory $BackendDir `
                    -FailureMessage 'ساخت ایندکس ناموفق بود.'
} else {
    $sizeMb = [math]::Round((Get-Item $IndexFile).Length / 1MB, 1)
    Write-Info "ایندکس موجود است ($sizeMb مگابایت). برای ساخت دوباره: -Rebuild"
}

# ─────────────────────────── فرانت‌اند ───────────────────────────

if ($Dev) {
    Write-Step 'حالت توسعه'

    if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
        Write-Info 'نصب وابستگی‌های فرانت‌اند…'
        Invoke-External -FilePath $npm -Arguments @('install') -WorkingDirectory $FrontendDir `
                        -FailureMessage 'نصب وابستگی‌های فرانت‌اند ناموفق بود.'
    }

    $backendUrl = "http://127.0.0.1:$Port"
    Write-Info "اجرای بک‌اند روی $backendUrl …"
    $env:PORT = "$Port"
    $backend = Start-Process -FilePath $VenvPython -ArgumentList @('-m', 'app.main') `
                             -WorkingDirectory $BackendDir -PassThru -NoNewWindow

    try {
        Write-Info 'اجرای سرور توسعهٔ Vite روی http://127.0.0.1:3000 …'
        Write-Host ''
        Write-Host '  برای توقف: Ctrl+C' -ForegroundColor DarkGray
        Write-Host ''
        if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:3000' | Out-Null }
        $env:BACKEND_URL = $backendUrl
        & $npm run dev
    }
    finally {
        if ($backend -and -not $backend.HasExited) {
            Write-Info 'توقف بک‌اند…'
            Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
        }
    }
    exit 0
}

Write-Step 'ساخت رابط کاربری'

$needBuild = $Rebuild -or -not (Test-Path (Join-Path $DistDir 'index.html'))
if ($needBuild) {
    if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
        Write-Info 'نصب وابستگی‌های فرانت‌اند — بار اول چند دقیقه طول می‌کشد…'
        Invoke-External -FilePath $npm -Arguments @('install') -WorkingDirectory $FrontendDir `
                        -FailureMessage 'نصب وابستگی‌های فرانت‌اند ناموفق بود.'
    }
    Write-Info 'بیلد نسخهٔ تولید…'
    Invoke-External -FilePath $npm -Arguments @('run', 'build') -WorkingDirectory $FrontendDir `
                    -FailureMessage 'بیلد فرانت‌اند ناموفق بود.'
} else {
    Write-Info 'بیلد موجود است. برای ساخت دوباره: -Rebuild'
}

# بک‌اند هرچه در static/ باشد را سرو می‌کند، پس بیلد تازه باید جایگزین شود
if ($needBuild -or -not (Test-Path (Join-Path $StaticDir 'index.html'))) {
    Write-Info 'انتقال بیلد به بک‌اند…'
    if (Test-Path $StaticDir) { Remove-Item $StaticDir -Recurse -Force }
    Copy-Item $DistDir $StaticDir -Recurse
}

# ─────────────────────────── اجرا ───────────────────────────

$url = "http://127.0.0.1:$Port"

Write-Step 'اجرای برنامه'
Write-Host ''
Write-Host "  $url" -ForegroundColor Green
Write-Host '  برای توقف: Ctrl+C' -ForegroundColor DarkGray
Write-Host ''

if (-not $NoBrowser) {
    # مرورگر را کمی پس از بالاآمدن سرور باز می‌کنیم تا صفحهٔ خطا نبیند
    Start-Job -ScriptBlock {
        param($u)
        Start-Sleep -Seconds 3
        Start-Process $u
    } -ArgumentList $url | Out-Null
}

$env:PORT = "$Port"
$env:HOST = '127.0.0.1'
Push-Location $BackendDir
try { & $VenvPython -m app.main }
finally {
    Pop-Location
    Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
    Write-Host "`n  برنامه متوقف شد." -ForegroundColor DarkGray
}
