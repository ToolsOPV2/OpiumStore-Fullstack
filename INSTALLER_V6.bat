@echo off
setlocal
set "TARGET=C:\Users\ggpix\Documents\OpiumStore_Fullstack"

if not exist "%TARGET%\worker\package.json" (
  echo ERREUR : package.json introuvable dans %TARGET%\worker
  echo Verifie que ce dossier est bien la racine du projet actif.
  pause
  exit /b 1
)

copy /Y "%~dp0frontend\app.js" "%TARGET%\frontend\app.js" >nul
copy /Y "%~dp0frontend\index.html" "%TARGET%\frontend\index.html" >nul
copy /Y "%~dp0worker\src\index.js" "%TARGET%\worker\src\index.js" >nul
copy /Y "%~dp0worker\migration_v5.sql" "%TARGET%\worker\migration_v5.sql" >nul
copy /Y "%~dp0worker\migration_v6.sql" "%TARGET%\worker\migration_v6.sql" >nul

echo Fichiers V6 copies dans %TARGET%
echo Lance ensuite DEPLOYER_V6.bat depuis le dossier du projet.
pause
