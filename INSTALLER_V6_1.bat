@echo off
setlocal EnableExtensions

set "BASE=C:\Users\ggpix\Documents\OpiumStore_Fullstack"
set "APP_ROOT="

if exist "%BASE%\worker\package.json" set "APP_ROOT=%BASE%"
if not defined APP_ROOT if exist "%BASE%\OpiumStore_Fullstack\worker\package.json" set "APP_ROOT=%BASE%\OpiumStore_Fullstack"

if not defined APP_ROOT (
  echo ERREUR : aucun worker\package.json trouve.
  echo Emplacements testes :
  echo   %BASE%\worker\package.json
  echo   %BASE%\OpiumStore_Fullstack\worker\package.json
  echo.
  echo Lance cette commande pour retrouver le bon fichier :
  echo   dir /s /b "%BASE%\package.json" ^| findstr /i "\worker\package.json"
  pause
  exit /b 1
)

if not exist "%APP_ROOT%\frontend" mkdir "%APP_ROOT%\frontend"
if not exist "%APP_ROOT%\worker\src" mkdir "%APP_ROOT%\worker\src"

copy /Y "%~dp0frontend\app.js" "%APP_ROOT%\frontend\app.js" >nul
if errorlevel 1 goto :copy_error
copy /Y "%~dp0frontend\index.html" "%APP_ROOT%\frontend\index.html" >nul
if errorlevel 1 goto :copy_error
copy /Y "%~dp0worker\src\index.js" "%APP_ROOT%\worker\src\index.js" >nul
if errorlevel 1 goto :copy_error
copy /Y "%~dp0worker\migration_v5.sql" "%APP_ROOT%\worker\migration_v5.sql" >nul
if errorlevel 1 goto :copy_error
copy /Y "%~dp0worker\migration_v6.sql" "%APP_ROOT%\worker\migration_v6.sql" >nul
if errorlevel 1 goto :copy_error

echo.
echo V6.1 installee dans :
echo %APP_ROOT%
echo.
echo Lance maintenant DEPLOYER_V6_1.bat.
pause
exit /b 0

:copy_error
echo.
echo ERREUR pendant la copie des fichiers.
pause
exit /b 1
