@echo off
rem Zara Copilot: hardware check. Double-click this file.
rem Starts hardware-check.ps1 without changing system settings (Bypass applies only to this run).
chcp 65001 >nul
set ZARA_NO_PAUSE=1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0hardware-check.ps1"
echo.
pause
