@echo off
setlocal EnableExtensions DisableDelayedExpansion

title TARS GST Workbench - KPMG Enterprise Launcher
set "PROJECT_ROOT=%~dp0"
set "FRONTEND_DIST=%PROJECT_ROOT%frontend\dist"
set "PYTHON_EXE=%PROJECT_ROOT%.venv\Scripts\python.exe"
set "APP_URL=http://127.0.0.1:8000"
set "BACKEND_HEALTH=http://127.0.0.1:8000/health"

cd /d "%PROJECT_ROOT%" || (
    echo [ERROR] Failed to access project directory: "%PROJECT_ROOT%"
    pause
    exit /b 1
)

echo.
echo ======================================================================
echo   TARS - GST AGENTIC RECONCILIATION WORKBENCH (KPMG EDITION)
echo ======================================================================
echo   Directory: %PROJECT_ROOT%
echo   Mode:      One-Touch Enterprise Distribution (Port 8000)
echo ======================================================================
echo.

:: ---------------------------------------------------------------------
:: 1. LOCATE OR VERIFY PYTHON RUNTIME
:: ---------------------------------------------------------------------
set "SYSTEM_PYTHON="

if exist "%PYTHON_EXE%" (
    set "SYSTEM_PYTHON=%PYTHON_EXE%"
    goto :python_ready
)

where python.exe >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%i in ('where python.exe') do (
        if not defined SYSTEM_PYTHON set "SYSTEM_PYTHON=%%i"
    )
)

if not defined SYSTEM_PYTHON (
    for %%P in (
        "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
        "C:\Program Files\Python312\python.exe"
        "C:\Program Files\Python311\python.exe"
        "C:\Program Files\Python313\python.exe"
        "C:\Program Files\Python310\python.exe"
        "C:\Python312\python.exe"
        "C:\Python311\python.exe"
    ) do (
        if exist "%%~P" (
            set "SYSTEM_PYTHON=%%~P"
            goto :found_python_path
        )
    )
)

:found_python_path
if not defined SYSTEM_PYTHON (
    echo [NOTICE] Python 3.11+ was not detected on this machine.
    echo.
    echo Attempting automated install via Windows Package Manager (winget)...
    where winget.exe >nul 2>&1
    if not errorlevel 1 (
        winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
        where python.exe >nul 2>&1
        if not errorlevel 1 (
            set "SYSTEM_PYTHON=python.exe"
            goto :python_ready
        )
    )
    echo.
    echo [ACTION REQUIRED] Please install Python 3.11+ (64-bit):
    echo   1. Open KPMG Software Center / Company Portal -^> Install "Python 3.12"
    echo   2. Or download Windows installer from https://www.python.org/downloads/
    echo      (CRITICAL: Check the box "Add python.exe to PATH" during install)
    echo.
    pause
    exit /b 1
)

:python_ready
echo [1/5] Python Runtime: %SYSTEM_PYTHON%

:: ---------------------------------------------------------------------
:: 2. CREATE VIRTUAL ENVIRONMENT IF MISSING
:: ---------------------------------------------------------------------
if not exist "%PYTHON_EXE%" (
    echo [2/5] Creating isolated virtual environment (.venv)...
    "%SYSTEM_PYTHON%" -m venv "%PROJECT_ROOT%.venv"
    if errorlevel 1 (
        echo [ERROR] Failed to create .venv virtual environment.
        pause
        exit /b 1
    )
    echo       Virtual environment initialized.
) else (
    echo [2/5] Virtual environment: Ready (.venv)
)

:: ---------------------------------------------------------------------
:: 3. CONFIGURE ENVIRONMENT FILE (.env)
:: ---------------------------------------------------------------------
if not exist "%PROJECT_ROOT%.env" (
    if exist "%PROJECT_ROOT%.env.example" (
        echo [3/5] Initializing .env configuration from template...
        copy "%PROJECT_ROOT%.env.example" "%PROJECT_ROOT%.env" >nul
    )
) else (
    echo [3/5] Configuration: Ready (.env)
)

:: ---------------------------------------------------------------------
:: 4. INSTALL / VERIFY BACKEND DEPENDENCIES
:: ---------------------------------------------------------------------
set "NEED_INSTALL=0"
"%PYTHON_EXE%" -c "import fastapi, uvicorn, pandas, openpyxl, rapidfuzz, calamine" >nul 2>&1
if errorlevel 1 set "NEED_INSTALL=1"

if "%NEED_INSTALL%"=="1" (
    echo [4/5] Installing backend dependencies from backend\requirements.txt...
    echo       (One-time setup: please wait 1-2 minutes)
    "%PYTHON_EXE%" -m pip install --upgrade pip --quiet
    "%PYTHON_EXE%" -m pip install -r "%PROJECT_ROOT%backend\requirements.txt" --quiet
    if errorlevel 1 (
        echo       Retrying with trusted hosts for corporate firewall/proxy...
        "%PYTHON_EXE%" -m pip install -r "%PROJECT_ROOT%backend\requirements.txt" --trusted-host pypi.org --trusted-host files.pythonhosted.org
        if errorlevel 1 (
            echo.
            echo [ERROR] Could not install dependencies over corporate network.
            echo If behind a KPMG corporate proxy, execute:
            echo   .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt --proxy http://proxy.kpmg.com:8080
            pause
            exit /b 1
        )
    )
    echo       Dependencies successfully installed.
) else (
    echo [4/5] Dependencies: Fully installed and verified.
)

:: ---------------------------------------------------------------------
:: 5. CHECK PRE-BUILT FRONTEND (ZERO NODE/NPM REQUIRED!)
:: ---------------------------------------------------------------------
if not exist "%FRONTEND_DIST%\index.html" (
    echo [ERROR] Pre-built frontend bundle missing from: %FRONTEND_DIST%
    pause
    exit /b 1
)
echo [5/5] Enterprise UI: Ready (pre-compiled, 0 Node.js/npm dependencies).

:: ---------------------------------------------------------------------
:: 6. LAUNCH APPLICATION (PORT 8000)
:: ---------------------------------------------------------------------
set "PYTHONPATH=%PROJECT_ROOT%;%PROJECT_ROOT%backend;%PYTHONPATH%"

call :check_backend
if not errorlevel 1 (
    echo.
    echo [NOTICE] TARS service is already running on port 8000.
    goto :ready
)

echo.
echo [START] Starting TARS application on port 8000...
start "TARS Backend Service" /MIN /D "%PROJECT_ROOT%" "%ComSpec%" /k "set "PYTHONPATH=%PROJECT_ROOT%;%PROJECT_ROOT%backend" && "%PYTHON_EXE%" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000"

echo [WAIT] Connecting to TARS service...
set /a attempts=0
:wait_loop
set /a attempts+=1
call :check_backend
if not errorlevel 1 goto :ready

if %attempts% geq 35 (
    echo.
    echo [WARNING] Service took longer than 35s to respond. Opening browser anyway...
    goto :ready
)
<nul set /p=.
>nul ping 127.0.0.1 -n 2
goto :wait_loop

:ready
echo.
echo.
echo ======================================================================
echo   SUCCESS! TARS WORKBENCH IS ONLINE AND READY.
echo ======================================================================
echo   Workbench UI:         %APP_URL%
echo   Health Diagnostics:   %BACKEND_HEALTH%
echo   Interactive API Docs: %APP_URL%/docs
echo.
echo   Sample Datasets included in sample_data\:
echo   - 60,000-Row Multi-Tranche: sample_data\TARS_KIGS_RECON_60000_Rows_Multi_Tranche_Scenarios.xlsx
echo   - 20,000-Row Single Ledger: sample_data\TARS_KIGS_RECON_20000_Rows_All_Scenarios.xlsx
echo   - Benchmark Double Ledger:  sample_data\POC_Government_GST_Aug2026.xlsx
echo ======================================================================
echo.
echo Opening TARS in your default web browser...
start "" "%APP_URL%"

echo.
echo Leave this launcher window open while using TARS.
echo Press any key to stop TARS services and exit...
pause >nul

echo.
echo [STOP] Terminating TARS background service...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*app.main:app*' } | Stop-Process -Force" >nul 2>&1

echo [OK] TARS service stopped. Have a productive day!
exit /b 0

:check_backend
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-RestMethod -Uri '%BACKEND_HEALTH%' -TimeoutSec 2; if ($r.status -eq 'ok') { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%
