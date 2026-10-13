@echo off
setlocal EnableExtensions

title TARS - Stopping Services...
echo ============================================================
echo   Stopping TARS Services (Backend and Frontend)...
echo ============================================================
echo.

powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*app.main:app*' } | Stop-Process -Force" >nul 2>&1

powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*vite*' } | Stop-Process -Force" >nul 2>&1

powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo [OK] All TARS services have been stopped.
echo.
>nul ping 127.0.0.1 -n 2
exit /b 0
