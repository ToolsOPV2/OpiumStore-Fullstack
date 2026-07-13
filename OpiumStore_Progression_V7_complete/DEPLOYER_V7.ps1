$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Deploiement OpiumStore Progression V7 ===" -ForegroundColor Cyan

$DefaultBase = Join-Path $env:USERPROFILE "Documents\OpiumStore_Fullstack"
$Base = if ($args.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($args[0])) { $args[0] } else { $DefaultBase }
if (-not (Test-Path -LiteralPath $Base)) { $Base = Read-Host "Colle le chemin du dossier OpiumStore_Fullstack" }
if (-not (Test-Path -LiteralPath $Base)) { throw "Dossier introuvable." }

$workerPackage = Get-ChildItem -LiteralPath $Base -Filter "package.json" -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.Directory.Name -eq "worker" -and $_.FullName -notmatch "\\node_modules\\" -and (Test-Path -LiteralPath (Join-Path $_.Directory.FullName "wrangler.toml")) } |
  Select-Object -First 1
if (-not $workerPackage) { throw "Aucun worker avec wrangler.toml n'a ete trouve." }

$Worker = $workerPackage.Directory.FullName
$ProjectRoot = Split-Path -Parent $Worker
foreach ($required in @("package.json","wrangler.toml","migration_v7.sql","src\index.js")) {
  if (-not (Test-Path -LiteralPath (Join-Path $Worker $required))) { throw "Fichier manquant : $required. Relance INSTALLER_V7.bat." }
}

$wranglerText = Get-Content -LiteralPath (Join-Path $Worker "wrangler.toml") -Raw
$match = [regex]::Match($wranglerText, 'database_name\s*=\s*"([^"]+)"')
$DatabaseName = if ($match.Success) { $match.Groups[1].Value } else { "opiumstore-db" }

function Run-Step {
  param([string]$Title, [scriptblock]$Command)
  Write-Host ""
  Write-Host $Title -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "La commande a echoue avec le code $LASTEXITCODE" }
}

Write-Host "Projet : $ProjectRoot"
Write-Host "Base D1 : $DatabaseName"

Push-Location $Worker
try {
  Run-Step "[1/3] Migration D1 V7" { & npx.cmd wrangler d1 execute $DatabaseName --remote --file=.\migration_v7.sql }
  Run-Step "[2/3] Installation des dependances" { & npm.cmd install }
  Run-Step "[3/3] Deploiement du Worker" { & npm.cmd run deploy }
} finally { Pop-Location }

Write-Host ""
Write-Host "Worker V7 deploye avec succes." -ForegroundColor Green
Write-Host ""
Write-Host "Pour publier le frontend, pousse maintenant les fichiers suivants sur GitHub :" -ForegroundColor Cyan
Write-Host "  frontend/app.js"
Write-Host "  frontend/index.html"
Write-Host "  frontend/progression.css"
Write-Host "  worker/src/index.js"
Write-Host "  worker/migration_v7.sql"
Write-Host ""
Write-Host "Commandes facultatives :" -ForegroundColor DarkGray
Write-Host "  git add frontend/app.js frontend/index.html frontend/progression.css worker/src/index.js worker/migration_v7.sql"
Write-Host "  git commit -m `"Progression XP, inventaire et evenements V7`""
Write-Host "  git push origin main"
Read-Host "Appuie sur Entree"
