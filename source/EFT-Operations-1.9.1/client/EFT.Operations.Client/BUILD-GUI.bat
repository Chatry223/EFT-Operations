@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0BUILD-GUI.ps1"
if errorlevel 1 (
  echo EFT Operations build helper could not start. Check Windows PowerShell availability.
  pause
)
