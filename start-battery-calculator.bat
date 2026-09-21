@echo off
cd /d "%~dp0"

if not exist node_modules (
    echo [Setup] Installing dependencies, please wait...
    call npm install --no-audit --no-fund
)

echo [Start] Battery Configuration Calculator: http://localhost:3000
echo [Info] Close this window to stop the server.

start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:3000"
node server/index.js
