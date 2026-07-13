@echo off
setlocal EnableExtensions

set "BASE=C:\Users\ggpix\Documents\OpiumStore_Fullstack"
set "APP_ROOT="

if exist "%BASE%\worker\package.json" set "APP_ROOT=%BASE%"
if not defined APP_ROOT if exist "%BASE%\OpiumStore_Fullstack\worker\package.json" set "APP_ROOT=%BASE%\OpiumStore_Fullstack"

if not defined APP_ROOT (
  echo ERREUR : aucun worker\package.json trouve.
  echo Lance d'abord INSTALLER_V6_1.bat ou verifie le dossier du projet.
  pause
  exit /b 1
)

echo Projet actif : %APP_ROOT%
cd /d "%APP_ROOT%\worker"

if not exist package.json (
  echo ERREUR : package.json introuvable dans %CD%
  pause
  exit /b 1
)
if not exist migration_v5.sql (
  echo ERREUR : migration_v5.sql introuvable dans %CD%
  pause
  exit /b 1
)
if not exist migration_v6.sql (
  echo ERREUR : migration_v6.sql introuvable dans %CD%
  pause
  exit /b 1
)

echo.
echo [1/4] Migration V5...
call npx wrangler d1 execute opiumstore-db --remote --file=.\migration_v5.sql
if errorlevel 1 goto :error

echo.
echo [2/4] Migration V6...
call npx wrangler d1 execute opiumstore-db --remote --file=.\migration_v6.sql
if errorlevel 1 goto :error

echo.
echo [3/4] Deploiement du Worker...
call npm install
if errorlevel 1 goto :error
call npm run deploy
if errorlevel 1 goto :error

echo.
echo [4/4] Envoi sur GitHub...
cd /d "%APP_ROOT%"
call git add frontend\app.js frontend\index.html worker\src\index.js worker\migration_v5.sql worker\migration_v6.sql
if errorlevel 1 goto :error

call git diff --cached --quiet
if errorlevel 1 (
  call git commit -m "VIP et limites journalieres V6.1"
  if errorlevel 1 goto :error
) else (
  echo Aucun nouveau changement a commit.
)

call git pull --rebase origin main
if errorlevel 1 goto :error
call git push origin main
if errorlevel 1 goto :error

echo.
echo V6.1 deployee avec succes.
echo Verifie : https://opiumstore-api.opiumstore.workers.dev/health?v=61
pause
exit /b 0

:error
echo.
echo Une commande a echoue. Lis le message juste au-dessus.
pause
exit /b 1
