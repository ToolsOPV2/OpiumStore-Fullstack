@echo off
setlocal
cd /d C:\Users\ggpix\Documents\OpiumStore_Fullstack\worker

if not exist package.json (
  echo ERREUR : worker\package.json introuvable.
  pause
  exit /b 1
)
if not exist migration_v6.sql (
  echo ERREUR : worker\migration_v6.sql introuvable.
  pause
  exit /b 1
)

call npx wrangler d1 execute opiumstore-db --remote --file=.\migration_v5.sql
if errorlevel 1 goto :error
call npx wrangler d1 execute opiumstore-db --remote --file=.\migration_v6.sql
if errorlevel 1 goto :error
call npm run deploy
if errorlevel 1 goto :error

cd /d C:\Users\ggpix\Documents\OpiumStore_Fullstack
call git add frontend\app.js frontend\index.html worker\src\index.js worker\migration_v5.sql worker\migration_v6.sql
call git commit -m "VIP et limites journalieres V6"
call git pull --rebase origin main
if errorlevel 1 goto :error
call git push origin main
if errorlevel 1 goto :error

echo.
echo V6 deployee. Verifie /health et recharge Render avec Ctrl+F5.
pause
exit /b 0

:error
echo.
echo Une commande a echoue. Lis le message juste au-dessus.
pause
exit /b 1
