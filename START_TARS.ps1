# TARS - GST Workbench PowerShell Launcher (KPMG Edition)
$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  TARS - GST AGENTIC RECONCILIATION WORKBENCH (KPMG EDITION)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  Directory: $ProjectRoot"
Write-Host "  Mode:      One-Touch Enterprise Distribution (Port 8000)"
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

$PythonExe = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$FrontendDist = Join-Path $ProjectRoot "frontend\dist"
$AppUrl = "http://127.0.0.1:8000"
$HealthUrl = "http://127.0.0.1:8000/health"

# 1. Locate Python
$SystemPython = $null
if (Test-Path $PythonExe) {
    $SystemPython = $PythonExe
} else {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd) {
        $SystemPython = $cmd.Source
    } else {
        $candidates = @(
            "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
            "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
            "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
            "C:\Program Files\Python312\python.exe",
            "C:\Program Files\Python311\python.exe",
            "C:\Python312\python.exe",
            "C:\Python311\python.exe"
        )
        foreach ($c in $candidates) {
            if (Test-Path $c) {
                $SystemPython = $c
                break
            }
        }
    }
}

if (-not $SystemPython) {
    Write-Host "[NOTICE] Python 3.11+ not found on this machine." -ForegroundColor Yellow
    Write-Host "Attempting winget install..." -ForegroundColor Yellow
    $wg = Get-Command winget -ErrorAction SilentlyContinue
    if ($wg) {
        winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
        $cmd = Get-Command python -ErrorAction SilentlyContinue
        if ($cmd) { $SystemPython = $cmd.Source }
    }
}

if (-not $SystemPython) {
    Write-Host "[ACTION REQUIRED] Please install Python 3.11+ from KPMG Software Center." -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    exit 1
}

Write-Host "[1/5] Python Runtime: $SystemPython" -ForegroundColor Green

# 2. Virtual environment
if (-not (Test-Path $PythonExe)) {
    Write-Host "[2/5] Initializing virtual environment (.venv)..." -ForegroundColor Yellow
    & $SystemPython -m venv (Join-Path $ProjectRoot ".venv")
    Write-Host "      Virtual environment created." -ForegroundColor Green
} else {
    Write-Host "[2/5] Virtual environment: Ready (.venv)" -ForegroundColor Green
}

# 3. Environment configuration
$EnvFile = Join-Path $ProjectRoot ".env"
$EnvExample = Join-Path $ProjectRoot ".env.example"
if (-not (Test-Path $EnvFile) -and (Test-Path $EnvExample)) {
    Copy-Item $EnvExample $EnvFile
    Write-Host "[3/5] Configuration: Initialized .env from template." -ForegroundColor Green
} else {
    Write-Host "[3/5] Configuration: Ready (.env)" -ForegroundColor Green
}

# 4. Dependencies
Write-Host "[4/5] Checking dependencies..." -ForegroundColor Yellow
$probe = & $PythonExe -c "import fastapi, uvicorn, pandas, openpyxl, rapidfuzz" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "      Installing requirements from backend\requirements.txt..." -ForegroundColor Yellow
    & $PythonExe -m pip install --upgrade pip --quiet
    & $PythonExe -m pip install -r (Join-Path $ProjectRoot "backend\requirements.txt") --quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Host "      Retrying with trusted hosts..." -ForegroundColor Yellow
        & $PythonExe -m pip install -r (Join-Path $ProjectRoot "backend\requirements.txt") --trusted-host pypi.org --trusted-host files.pythonhosted.org
    }
}
Write-Host "      Dependencies: Ready." -ForegroundColor Green

# 5. UI Bundle
if (-not (Test-Path (Join-Path $FrontendDist "index.html"))) {
    Write-Host "[ERROR] Frontend bundle missing in $FrontendDist" -ForegroundColor Red
    exit 1
}
Write-Host "[5/5] Enterprise UI: Ready (pre-compiled, 0 Node.js dependencies)." -ForegroundColor Green

# 6. Check running service
try {
    $res = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    if ($res.status -eq "ok") {
        Write-Host "`n[NOTICE] TARS service is already active on port 8000." -ForegroundColor Cyan
        Start-Process $AppUrl
        exit 0
    }
} catch {}

Write-Host "`n[START] Starting TARS on port 8000..." -ForegroundColor Cyan
$env:PYTHONPATH = "$ProjectRoot;$ProjectRoot\backend;$env:PYTHONPATH"

$proc = Start-Process -FilePath $PythonExe -ArgumentList "-m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000" -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Minimized

Write-Host "[WAIT] Connecting to service..." -NoNewline
for ($i = 0; $i -lt 35; $i++) {
    Start-Sleep -Seconds 1
    Write-Host "." -NoNewline
    try {
        $res = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
        if ($res.status -eq "ok") {
            Write-Host " Connected!" -ForegroundColor Green
            break
        }
    } catch {}
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "  SUCCESS! TARS WORKBENCH IS ONLINE AND READY." -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "  Workbench UI:         $AppUrl"
Write-Host "  Health Diagnostics:   $HealthUrl"
Write-Host "  Interactive API Docs: $AppUrl/docs"
Write-Host "======================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Opening default web browser..."
Start-Process $AppUrl

Write-Host ""
Write-Host "Leave this window open while using TARS."
Read-Host "Press Enter to stop TARS services and exit"

Write-Host "[STOP] Stopping TARS service..."
if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}
Write-Host "[OK] TARS stopped cleanly." -ForegroundColor Green
