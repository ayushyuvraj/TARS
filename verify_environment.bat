@echo off
setlocal EnableExtensions DisableDelayedExpansion

title TARS KPMG Pre-Flight Environment Diagnostic
cd /d "%~dp0"

echo ============================================================
echo   TARS Environment Diagnostic (KPMG Verification)
echo ============================================================
echo.

set "ALL_OK=1"

:: 1. Check Python
echo [1/4] Checking Python Installation...
where python >nul 2>&1
if errorlevel 1 (
  echo   [FAIL] Python is NOT found on PATH.
  echo          Recommendation: Install Python 3.11+ (64-bit) from KPMG Software Portal or python.org.
  echo          IMPORTANT: Ensure "Add Python to PATH" is checked during installation.
  set "ALL_OK=0"
) else (
  python -c "import sys; v = sys.version_info; sys.exit(0 if (v[0] == 3 and v[1] >= 11) else 1)" >nul 2>&1
  if errorlevel 1 (
    for /f "tokens=*" %%V in ('python --version 2^>^&1') do set "PY_VER=%%V"
    echo   [FAIL] Current Python version is %PY_VER%.
    echo          TARS requires Python 3.11 or higher (e.g., Python 3.11.x, 3.12.x).
    set "ALL_OK=0"
  ) else (
    for /f "tokens=*" %%V in ('python --version 2^>^&1') do echo   [PASS] Found %%V
  )
)
echo.

:: 2. Check Node.js and npm
echo [2/4] Checking Node.js and npm...
where node >nul 2>&1
if errorlevel 1 (
  echo   [FAIL] Node.js is NOT found on PATH.
  echo          Recommendation: Install Node.js 20+ LTS from KPMG Software Portal or nodejs.org.
  set "ALL_OK=0"
) else (
  node -e "const v = parseInt(process.versions.node.split('.')[0]); process.exit(v >= 20 ? 0 : 1);" >nul 2>&1
  if errorlevel 1 (
    for /f "tokens=*" %%V in ('node --version 2^>^&1') do set "NODE_VER=%%V"
    echo   [WARN] Current Node.js version is %NODE_VER%. Node.js 20+ LTS is recommended.
  ) else (
    for /f "tokens=*" %%V in ('node --version 2^>^&1') do echo   [PASS] Found Node.js %%V
  )
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo   [FAIL] npm is NOT found on PATH.
  set "ALL_OK=0"
) else (
  for /f "tokens=*" %%V in ('npm.cmd --version 2^>^&1') do echo   [PASS] Found npm %%V
)
echo.

:: 3. Check Port Availability
echo [3/4] Checking Required Ports (8000 and 5173)...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue) { exit 1 }; exit 0" >nul 2>&1
if errorlevel 1 (
  echo   [WARN] Port 8000 (Backend) is currently in use.
  echo          Ensure no other service or previous TARS instance is listening on 8000.
) else (
  echo   [PASS] Port 8000 is free.
)

powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue) { exit 1 }; exit 0" >nul 2>&1
if errorlevel 1 (
  echo   [WARN] Port 5173 (Frontend) is currently in use.
  echo          Ensure no other service or previous Vite instance is listening on 5173.
) else (
  echo   [PASS] Port 5173 is free.
)
echo.

:: 4. Summary
echo [4/4] Environment Summary...
if "%ALL_OK%"=="1" (
  echo   ============================================================
  echo   [READY] All core prerequisites are satisfied!
  echo   You can proceed to run:
  echo     1. setup.bat   (to install dependencies)
  echo     2. run.bat     (to start the application)
  echo   ============================================================
) else (
  echo   ============================================================
  echo   [ACTION REQUIRED] One or more prerequisites are missing.
  echo   Review the [FAIL] items above and refer to KPMG_DEPLOYMENT_GUIDE.md.
  echo   ============================================================
)

echo.
pause
