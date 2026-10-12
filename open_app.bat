@echo off
setlocal EnableExtensions DisableDelayedExpansion

title TARS - GST Workbench Launcher
set "PROJECT_ROOT=%~dp0"
set "FRONTEND_DIR=%PROJECT_ROOT%frontend"
set "PYTHON_EXE=%PROJECT_ROOT%.venv\Scripts\python.exe"
set "APP_URL=http://127.0.0.1:5173"
set "BACKEND_HEALTH=http://127.0.0.1:8000/health"
set "FRONTEND_HEALTH=http://127.0.0.1:5173/health"

cd /d "%PROJECT_ROOT%" || (
    echo [ERROR] Failed to switch to project directory: "%PROJECT_ROOT%"
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   TARS GST Agentic Reconciliation Workbench
echo ============================================================
echo   Project Directory: %PROJECT_ROOT%
echo.

:: 1. Validate environment
if not exist "%PYTHON_EXE%" (
    echo [ERROR] Python environment not found at:
    echo         %PYTHON_EXE%
    echo Please run setup.bat first to create the environment.
    echo.
    pause
    exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
    echo [ERROR] Frontend directory not found at:
    echo         %FRONTEND_DIR%
    echo.
    pause
    exit /b 1
)

:: 2. Check or launch Backend (FastAPI / Uvicorn)
call :check_backend
if errorlevel 1 (
    echo [START] Starting Backend service on port 8000...
    start "TARS Backend Service" /MIN /D "%PROJECT_ROOT%" "%ComSpec%" /k ""%PYTHON_EXE%" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload"
) else (
    echo [OK] Backend service is already running.
)

:: 3. Check or launch Frontend (Vite)
call :check_frontend
if errorlevel 1 (
    echo [START] Starting Frontend service on port 5173...
    start "TARS Frontend Service" /MIN /D "%FRONTEND_DIR%" "%ComSpec%" /k "npm.cmd run dev"
) else (
    echo [OK] Frontend service is already running.
)

:: 4. Wait for both services to be ready
echo.
echo [WAIT] Connecting to services...

set /a attempts=0
:wait_loop
set /a attempts+=1

call :check_backend
set backend_status=%errorlevel%

call :check_frontend
set frontend_status=%errorlevel%

if %backend_status% equ 0 if %frontend_status% equ 0 goto :ready

if %attempts% geq 30 (
    echo.
    echo [WARNING] Services took longer than 30s to respond.
    echo Trying to open browser anyway...
    goto :ready
)

<nul set /p=.
>nul ping 127.0.0.1 -n 2
goto :wait_loop

:ready
echo.
echo.
echo ============================================================
echo   SUCCESS! TARS is active and running.
echo ============================================================
echo   Frontend Workbench:   %APP_URL%
echo   Backend API Health:   %BACKEND_HEALTH%
echo   Interactive API Docs: http://127.0.0.1:8000/docs
echo ============================================================
echo.
echo Opening TARS in your default browser...
start "" "%APP_URL%"

echo.
echo Leave this window open while using TARS.
echo Press any key to stop all TARS services and exit...
pause >nul

echo.
echo [STOP] Stopping services...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*app.main:app*' } | Stop-Process -Force" >nul 2>&1

powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*vite*' } | Stop-Process -Force" >nul 2>&1

echo [OK] TARS services stopped.
exit /b 0

:check_backend
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-RestMethod -Uri '%BACKEND_HEALTH%' -TimeoutSec 2; if ($r.status -eq 'ok') { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

:check_frontend
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "try { $p = Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%/' -TimeoutSec 2; if ($p.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%
