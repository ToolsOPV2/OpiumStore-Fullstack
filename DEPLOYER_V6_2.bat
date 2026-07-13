@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0DEPLOYER_V6_2.ps1"
exit /b %errorlevel%
