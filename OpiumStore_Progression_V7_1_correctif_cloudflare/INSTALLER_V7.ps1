$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Installation OpiumStore Progression V7 ===" -ForegroundColor Cyan

$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PayloadRoot = Join-Path $PackageRoot "payload"
$DefaultBase = Join-Path $env:USERPROFILE "Documents\OpiumStore_Fullstack"
$Base = if ($args.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($args[0])) { $args[0] } else { $DefaultBase }

$requiredPayload = @(
  "frontend\app.js",
  "frontend\index.html",
  "frontend\progression.css",
  "worker\src\index.js",
  "worker\migration_v7.sql"
)

foreach ($relative in $requiredPayload) {
  $full = Join-Path $PayloadRoot $relative
  if (-not (Test-Path -LiteralPath $full)) {
    Write-Host "ERREUR : fichier du pack manquant : $full" -ForegroundColor Red
    Write-Host "Extrais entièrement le ZIP avant de relancer le BAT." -ForegroundColor Yellow
    Read-Host "Appuie sur Entree"
    exit 1
  }
}

if (-not (Test-Path -LiteralPath $Base)) {
  Write-Host "Le dossier par defaut est introuvable : $Base" -ForegroundColor Yellow
  $Base = Read-Host "Colle le chemin du dossier OpiumStore_Fullstack"
}
if (-not (Test-Path -LiteralPath $Base)) {
  Write-Host "ERREUR : dossier introuvable." -ForegroundColor Red
  Read-Host "Appuie sur Entree"
  exit 1
}

function Add-UniqueRoot {
  param([System.Collections.ArrayList]$List, [string]$Root)
  if ([string]::IsNullOrWhiteSpace($Root)) { return }
  if (-not (Test-Path -LiteralPath (Join-Path $Root "worker\package.json"))) { return }
  if (-not (Test-Path -LiteralPath (Join-Path $Root "frontend\index.html"))) { return }
  $resolved = (Resolve-Path -LiteralPath $Root).Path
  foreach ($existing in $List) {
    if ($existing.Equals($resolved, [System.StringComparison]::OrdinalIgnoreCase)) { return }
  }
  [void]$List.Add($resolved)
}

$roots = New-Object System.Collections.ArrayList
Add-UniqueRoot $roots $Base
Add-UniqueRoot $roots (Join-Path $Base "OpiumStore_Fullstack")
Get-ChildItem -LiteralPath $Base -Filter "package.json" -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.Directory.Name -eq "worker" -and $_.FullName -notmatch "\\node_modules\\" } |
  ForEach-Object { Add-UniqueRoot $roots (Split-Path -Parent $_.Directory.FullName) }

if ($roots.Count -eq 0) {
  Write-Host "ERREUR : aucun projet complet avec frontend et worker n'a ete trouve." -ForegroundColor Red
  Read-Host "Appuie sur Entree"
  exit 1
}

$ProjectRoot = $roots[0]
if ($roots.Count -gt 1) {
  Write-Host "Plusieurs copies ont ete detectees :" -ForegroundColor Yellow
  for ($i=0; $i -lt $roots.Count; $i++) { Write-Host "[$($i+1)] $($roots[$i])" }
  $choice = Read-Host "Numero du projet a mettre a jour (1 par defaut)"
  if ($choice -match '^\d+$' -and [int]$choice -ge 1 -and [int]$choice -le $roots.Count) { $ProjectRoot = $roots[[int]$choice-1] }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $ProjectRoot "_backup_progression_v7_$stamp"
New-Item -ItemType Directory -Path (Join-Path $BackupRoot "frontend") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $BackupRoot "worker\src") -Force | Out-Null

$backupFiles = @(
  "frontend\app.js",
  "frontend\index.html",
  "frontend\progression.css",
  "worker\src\index.js",
  "worker\migration_v7.sql"
)
foreach ($relative in $backupFiles) {
  $source = Join-Path $ProjectRoot $relative
  if (Test-Path -LiteralPath $source) {
    $destination = Join-Path $BackupRoot $relative
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
  }
}

function Copy-Checked {
  param([string]$Source, [string]$Destination)
  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
  if (-not (Test-Path -LiteralPath $Destination)) { throw "Copie impossible vers $Destination" }
  Write-Host "OK  $Destination" -ForegroundColor Green
}

Write-Host ""
Write-Host "Projet choisi : $ProjectRoot" -ForegroundColor Cyan
Write-Host "Sauvegarde : $BackupRoot" -ForegroundColor DarkGray

Copy-Checked (Join-Path $PayloadRoot "frontend\app.js") (Join-Path $ProjectRoot "frontend\app.js")
Copy-Checked (Join-Path $PayloadRoot "frontend\index.html") (Join-Path $ProjectRoot "frontend\index.html")
Copy-Checked (Join-Path $PayloadRoot "frontend\progression.css") (Join-Path $ProjectRoot "frontend\progression.css")
Copy-Checked (Join-Path $PayloadRoot "worker\src\index.js") (Join-Path $ProjectRoot "worker\src\index.js")
Copy-Checked (Join-Path $PayloadRoot "worker\migration_v7.sql") (Join-Path $ProjectRoot "worker\migration_v7.sql")

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  & node --check (Join-Path $ProjectRoot "frontend\app.js")
  if ($LASTEXITCODE -ne 0) { throw "Erreur JavaScript dans frontend\app.js" }
  & node --check (Join-Path $ProjectRoot "worker\src\index.js")
  if ($LASTEXITCODE -ne 0) { throw "Erreur JavaScript dans worker\src\index.js" }
  Write-Host "Verification JavaScript : OK" -ForegroundColor Green
}

Write-Host ""
Write-Host "INSTALLATION V7 TERMINEE." -ForegroundColor Green
Write-Host "Lance maintenant DEPLOYER_V7.bat depuis le dossier extrait."
Read-Host "Appuie sur Entree"
