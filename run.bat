@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "PROJECT_ROOT=%~dp0"
set "FRONTEND_DIR=%PROJECT_ROOT%frontend"
set "PYTHON_EXE=%PROJECT_ROOT%.venv\Scripts\python.exe"
set "APP_URL=http://127.0.0.1:5173"
set "BACKEND_HEALTH=http://127.0.0.1:8000/health"
set "FRONTEND_HEALTH=http://127.0.0.1:5173/health"

title TARS Launcher (KPMG Edition)
cd /d "%PROJECT_ROOT%" || goto :bad_root

echo ============================================================
echo  TARS GST Agentic Reconciliation Workbench (KPMG Edition)
echo ============================================================
echo  Location: %PROJECT_ROOT%
echo.

:: Pre-check setup
if not exist "%PYTHON_EXE%" (
  echo [NOTICE] Python virtual environment was not found.
  echo Running setup automatically...
  call "%PROJECT_ROOT%setup.bat"
  if errorlevel 1 goto :fail
)

if not exist "%FRONTEND_DIR%\node_modules" (
  echo [NOTICE] Frontend dependencies were not found.
  echo Running setup automatically...
  call "%PROJECT_ROOT%setup.bat"
  if errorlevel 1 goto :fail
)

:: Check Backend
call :check_backend
if not errorlevel 1 (
  echo [OK] Backend is already running and healthy at %BACKEND_HEALTH%
) else (
  call :port_in_use 8000
  if not errorlevel 1 goto :backend_port_busy

  echo [START] Launching TARS Backend (FastAPI)...
  start "TARS Backend Service" /MIN /D "%PROJECT_ROOT%" "%ComSpec%" /k ""%PYTHON_EXE%" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload"
)

echo [WAIT] Waiting for backend to become ready...
call :wait_backend 60
if errorlevel 1 goto :backend_failed

:: Check Frontend
call :check_frontend
if not errorlevel 1 (
  echo [OK] Frontend is already healthy at %APP_URL%
) else (
  call :port_in_use 5173
  if not errorlevel 1 goto :frontend_port_busy

  echo [START] Launching TARS Frontend (React / Vite)...
  start "TARS Frontend Service" /MIN /D "%FRONTEND_DIR%" "%ComSpec%" /k "npm.cmd run dev -- --host 127.0.0.1 --port 5173"
)

echo [WAIT] Waiting for frontend application shell...
call :wait_frontend 60
if errorlevel 1 goto :frontend_failed

echo.
echo ============================================================
echo   [READY] TARS IS FULLY RUNNING AND OPERATIONAL!
echo ============================================================
echo   Application URL: %APP_URL%
echo   Backend Health:  %BACKEND_HEALTH%
echo   Swagger Docs:    http://127.0.0.1:8000/docs
echo ============================================================
echo.
echo Opening TARS in your default browser...
start "" "%APP_URL%"
echo.
echo Press any key to stop TARS and close service windows...
pause >nul

echo [STOP] Stopping services...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*app.main:app*' } | Stop-Process -Force" >nul 2>&1
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*vite*' } | Stop-Process -Force" >nul 2>&1
echo TARS services stopped.
exit /b 0

:check_backend
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-RestMethod -Uri '%BACKEND_HEALTH%' -TimeoutSec 2; if ($r.status -eq 'ok' -and $r.database -eq 'ok') { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

:check_frontend
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "try { $h = Invoke-RestMethod -Uri '%FRONTEND_HEALTH%' -TimeoutSec 2; $p = Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%/' -TimeoutSec 2; $needle = 'id=' + [char]34 + 'root' + [char]34; if ($h.status -eq 'ok' -and $p.StatusCode -eq 200 -and $p.Content.Contains($needle)) { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

:port_in_use
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "if (Get-NetTCPConnection -State Listen -LocalPort %~1 -ErrorAction SilentlyContinue) { exit 0 }; exit 1" >nul 2>&1
exit /b %errorlevel%

:wait_backend
for /L %%I in (1,1,%~1) do (
  call :check_backend
  if not errorlevel 1 (
    echo [OK] Backend is ready.
    exit /b 0
  )
  >nul ping 127.0.0.1 -n 2
)
exit /b 1

:wait_frontend
for /L %%I in (1,1,%~1) do (
  call :check_frontend
  if not errorlevel 1 (
    echo [OK] Frontend is ready.
    exit /b 0
  )
  >nul ping 127.0.0.1 -n 2
)
exit /b 1

:bad_root
echo [ERROR] Failed to locate project directory.
goto :fail

:backend_port_busy
echo [ERROR] Port 8000 is in use, but health check failed. Stop the conflicting process.
goto :fail

:frontend_port_busy
echo [ERROR] Port 5173 is in use, but frontend check failed. Stop the conflicting process.
goto :fail

:backend_failed
echo [ERROR] Backend did not respond within 60 seconds. Check the backend window.
goto :fail

:frontend_failed
echo [ERROR] Frontend did not respond within 60 seconds. Check the frontend window.
goto :fail

:fail
echo.
pause
exit /b 1
