@echo off
setlocal EnableExtensions DisableDelayedExpansion

title TARS KPMG Automated Setup
cd /d "%~dp0"

echo ============================================================
echo   TARS Automated Setup & Dependency Installation
echo ============================================================
echo   Directory: %~dp0
echo.

:: 1. Check Python
where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python is not installed or not added to PATH.
  echo Please install Python 3.11+ (64-bit) before running setup.
  echo See KPMG_DEPLOYMENT_GUIDE.md for details.
  pause
  exit /b 1
)

:: 2. Check Node & npm
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js / npm is not installed or not added to PATH.
  echo Please install Node.js 20+ LTS before running setup.
  echo See KPMG_DEPLOYMENT_GUIDE.md for details.
  pause
  exit /b 1
)

:: 3. Prepare .env configuration
if not exist ".env" (
  if exist ".env.example" (
    echo [CONFIG] Creating .env from .env.example...
    copy ".env.example" ".env" >nul
    echo [CONFIG] .env created. You can open .env to configure your OPENAI_API_KEY.
  )
)

:: 4. Create Python Virtual Environment (.venv)
if not exist ".venv\Scripts\python.exe" (
  echo.
  echo [PYTHON] Creating virtual environment (.venv)...
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] Failed to create virtual environment.
    pause
    exit /b 1
  )
  echo [PYTHON] Virtual environment created successfully.
) else (
  echo [PYTHON] Virtual environment (.venv) already exists.
)

:: 5. Install Python Dependencies
echo.
echo [PYTHON] Upgrading pip and installing backend dependencies...
echo (This may take 1-3 minutes depending on your network connection)
.\.venv\Scripts\python.exe -m pip install --upgrade pip --quiet
if exist "backend\requirements.txt" (
  .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
  if errorlevel 1 (
    echo.
    echo [ERROR] Failed to install backend requirements.
    echo If behind a KPMG corporate proxy, refer to the proxy section in KPMG_DEPLOYMENT_GUIDE.md.
    pause
    exit /b 1
  )
)

echo [PYTHON] Registering local backend package...
.\.venv\Scripts\python.exe -m pip install -e backend --no-deps >nul 2>&1

:: 6. Install Frontend Dependencies
echo.
echo [FRONTEND] Installing Node.js frontend dependencies...
echo (This may take 1-2 minutes)
pushd frontend
call npm.cmd install
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to install frontend dependencies.
  echo If behind a KPMG corporate proxy, refer to the proxy section in KPMG_DEPLOYMENT_GUIDE.md.
  popd
  pause
  exit /b 1
)
popd

echo.
echo ============================================================
echo   [SUCCESS] TARS setup is 100%% complete!
echo ============================================================
echo   To launch the application:
echo     Run "run.bat" or "START_TARS.bat"
echo.
pause
