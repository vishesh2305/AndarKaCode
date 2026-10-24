@echo off
echo Starting Gateway and Builder API in separate windows...

start "Gateway (Port 8787)" "%~dp0gateway\start.bat"
start "Builder API (Port 4000)" "%~dp0builder-api\start.bat"

echo Done. You can check both terminal windows now.
