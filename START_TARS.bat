@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "PROJECT_ROOT=%~dp0"
set "FRONTEND_DIR=%PROJECT_ROOT%frontend"
set "PYTHON_EXE=%PROJECT_ROOT%.venv\Scripts\python.exe"
set "APP_URL=http://127.0.0.1:5173"
set "BACKEND_HEALTH=http://127.0.0.1:8000/health"
set "FRONTEND_HEALTH=http://127.0.0.1:5173/health"

title TARS Launcher
cd /d "%PROJECT_ROOT%" || goto :bad_root

echo.
echo ============================================================
echo  TARS GST Agentic Reconciliation Workbench
echo ============================================================
echo  Project: %PROJECT_ROOT%
echo.

call :check_backend
if not errorlevel 1 (
  echo [OK] Backend is already healthy at %BACKEND_HEALTH%
) else (
  call :port_in_use 8000
  if not errorlevel 1 goto :backend_port_busy
  if not exist "%PYTHON_EXE%" goto :missing_python
  "%PYTHON_EXE%" -c "import fastapi, uvicorn" >nul 2>&1
  if errorlevel 1 goto :missing_backend_dependencies

  echo [START] Launching backend with the existing project environment...
  start "TARS Backend" /MIN /D "%PROJECT_ROOT%" "%ComSpec%" /k ""%PYTHON_EXE%" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload"
)

echo.
echo [WAIT] Waiting for the backend health endpoint...
call :wait_backend 60
if errorlevel 1 goto :backend_failed

call :check_frontend
if not errorlevel 1 (
  echo [OK] Frontend is already healthy at %APP_URL%
) else (
  call :port_in_use 5173
  if not errorlevel 1 goto :frontend_port_busy
  where npm.cmd >nul 2>&1
  if errorlevel 1 goto :missing_node
  if not exist "%FRONTEND_DIR%\package.json" goto :missing_frontend
  if not exist "%FRONTEND_DIR%\node_modules\.bin\vite.cmd" goto :missing_frontend_dependencies

  echo [START] Launching frontend with the existing installed dependencies...
  start "TARS Frontend" /MIN /D "%FRONTEND_DIR%" "%ComSpec%" /k "npm.cmd run dev -- --host 127.0.0.1 --port 5173"
)

echo.
echo [WAIT] Waiting for the frontend health endpoint and application shell...
call :wait_frontend 60
if errorlevel 1 goto :frontend_failed

echo.
echo [READY] Backend:  %BACKEND_HEALTH%
echo [READY] Frontend: %APP_URL%
echo [OPEN] Opening TARS in the default browser...
start "" "%APP_URL%"
echo.
echo TARS is ready. Backend and frontend service windows may be closed
echo when you are finished using the application.
ping 127.0.0.1 -n 4 >nul
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
    echo [OK] Backend is healthy.
    exit /b 0
  )
  >nul ping 127.0.0.1 -n 2
)
exit /b 1

:wait_frontend
for /L %%I in (1,1,%~1) do (
  call :check_frontend
  if not errorlevel 1 (
    echo [OK] Frontend is healthy and serving the application.
    exit /b 0
  )
  >nul ping 127.0.0.1 -n 2
)
exit /b 1

:bad_root
echo [ERROR] The launcher could not enter its project directory.
echo Move START_TARS.bat back to the TARS project root and try again.
goto :fail

:missing_python
echo [ERROR] The project Python environment was not found:
echo         %PYTHON_EXE%
echo Create the repository .venv and install the backend dependencies as
echo documented in README.md, then run this launcher again.
goto :fail

:missing_backend_dependencies
echo [ERROR] FastAPI or Uvicorn is missing from the existing project .venv.
echo Follow the backend setup commands in README.md. This launcher will not
echo install or modify dependencies automatically.
goto :fail

:missing_node
echo [ERROR] npm.cmd is not available on PATH.
echo Install the Node.js version required by README.md, then try again.
goto :fail

:missing_frontend
echo [ERROR] frontend\package.json was not found under the project root.
echo Confirm that START_TARS.bat is in the correct repository checkout.
goto :fail

:missing_frontend_dependencies
echo [ERROR] Existing frontend dependencies were not found.
echo Expected: frontend\node_modules\.bin\vite.cmd
echo Run the documented frontend setup manually. This launcher will not run
echo npm install or modify dependencies.
goto :fail

:backend_port_busy
echo [ERROR] Port 8000 is already in use, but the TARS backend health check failed.
echo Stop the process using port 8000, then run START_TARS.bat again.
echo To identify it:  netstat -ano ^| findstr :8000
goto :fail

:frontend_port_busy
echo [ERROR] Port 5173 is already in use, but the TARS frontend check failed.
echo Stop the process using port 5173, then run START_TARS.bat again.
echo To identify it:  netstat -ano ^| findstr :5173
goto :fail

:backend_failed
echo [ERROR] The backend did not become healthy within 60 seconds.
echo Review the minimized "TARS Backend" window for the Python error.
echo Confirm that port 8000 is free and the .venv dependencies are intact.
goto :fail

:frontend_failed
echo [ERROR] The frontend did not become ready within 60 seconds.
echo Review the minimized "TARS Frontend" window for the Vite/npm error.
echo Confirm that port 5173 is free and frontend\node_modules exists.
goto :fail

:fail
echo.
echo TARS was not opened. Resolve the error above and run this file again.
pause
exit /b 1
