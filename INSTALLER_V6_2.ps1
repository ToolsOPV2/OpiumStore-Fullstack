$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Installation OpiumStore V6.2 ===" -ForegroundColor Cyan

$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PayloadRoot = Join-Path $PackageRoot "payload"
$Base = Join-Path $env:USERPROFILE "Documents\OpiumStore_Fullstack"

$requiredPayload = @(
    "frontend\app.js",
    "frontend\index.html",
    "worker\src\index.js",
    "worker\migration_v5.sql",
    "worker\migration_v6.sql"
)

foreach ($relative in $requiredPayload) {
    $full = Join-Path $PayloadRoot $relative
    if (-not (Test-Path -LiteralPath $full)) {
        Write-Host ""
        Write-Host "ERREUR : fichier source manquant :" -ForegroundColor Red
        Write-Host $full -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Tu lances probablement le script directement depuis le ZIP."
        Write-Host "Fais clic droit sur le ZIP > Extraire tout, puis relance INSTALLER_V6_2.bat."
        Read-Host "Appuie sur Entree"
        exit 1
    }
}

if (-not (Test-Path -LiteralPath $Base)) {
    Write-Host "ERREUR : dossier du projet introuvable :" -ForegroundColor Red
    Write-Host $Base
    Read-Host "Appuie sur Entree"
    exit 1
}

function Add-UniqueRoot {
    param([System.Collections.ArrayList]$List, [string]$Root)
    if ([string]::IsNullOrWhiteSpace($Root)) { return }
    if (-not (Test-Path -LiteralPath (Join-Path $Root "worker\package.json"))) { return }
    $resolved = (Resolve-Path -LiteralPath $Root).Path
    foreach ($existing in $List) {
        if ($existing.Equals($resolved, [System.StringComparison]::OrdinalIgnoreCase)) { return }
    }
    [void]$List.Add($resolved)
}

$roots = New-Object System.Collections.ArrayList
Add-UniqueRoot $roots (Join-Path $Base "OpiumStore_Fullstack")
Add-UniqueRoot $roots $Base

Get-ChildItem -LiteralPath $Base -Filter "package.json" -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Directory.Name -eq "worker" -and
        $_.FullName -notmatch "\\node_modules\\"
    } |
    ForEach-Object {
        Add-UniqueRoot $roots (Split-Path -Parent $_.Directory.FullName)
    }

if ($roots.Count -eq 0) {
    Write-Host ""
    Write-Host "ERREUR : aucun worker\package.json trouve sous :" -ForegroundColor Red
    Write-Host $Base
    Write-Host ""
    Write-Host "Commande de diagnostic :"
    Write-Host "dir /s /b `"$Base\package.json`""
    Read-Host "Appuie sur Entree"
    exit 1
}

$gitRoot = $null
try {
    $gitRoot = (& git -C $Base rev-parse --show-toplevel 2>$null).Trim()
} catch {}

function Get-RelativeToGit {
    param([string]$Root, [string]$SubPath)
    if ([string]::IsNullOrWhiteSpace($gitRoot)) { return $null }
    $g = (Resolve-Path -LiteralPath $gitRoot).Path.TrimEnd("\")
    $r = (Resolve-Path -LiteralPath $Root).Path.TrimEnd("\")
    if (-not $r.StartsWith($g, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
    $prefix = $r.Substring($g.Length).TrimStart("\")
    if ($prefix) { return ($prefix + "\" + $SubPath) }
    return $SubPath
}

$frontendRoot = $null
if ($gitRoot) {
    foreach ($root in $roots) {
        $rel = Get-RelativeToGit $root "frontend\app.js"
        if ($rel) {
            $tracked = & git -C $gitRoot ls-files -- $rel 2>$null
            if ($tracked) {
                $frontendRoot = $root
                break
            }
        }
    }
}
if (-not $frontendRoot) { $frontendRoot = $roots[0] }

function Copy-Checked {
    param([string]$Source, [string]$Destination)
    $parent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
    if (-not (Test-Path -LiteralPath $Destination)) {
        throw "La copie a echoue vers : $Destination"
    }
    Write-Host "OK  $Destination" -ForegroundColor Green
}

Write-Host ""
Write-Host "Projet frontend suivi par Git :" -ForegroundColor Cyan
Write-Host $frontendRoot

Copy-Checked (Join-Path $PayloadRoot "frontend\app.js") (Join-Path $frontendRoot "frontend\app.js")
Copy-Checked (Join-Path $PayloadRoot "frontend\index.html") (Join-Path $frontendRoot "frontend\index.html")

Write-Host ""
Write-Host "Mise a jour de toutes les copies Worker detectees :" -ForegroundColor Cyan
foreach ($root in $roots) {
    Write-Host "-> $root"
    Copy-Checked (Join-Path $PayloadRoot "worker\src\index.js") (Join-Path $root "worker\src\index.js")
    Copy-Checked (Join-Path $PayloadRoot "worker\migration_v5.sql") (Join-Path $root "worker\migration_v5.sql")
    Copy-Checked (Join-Path $PayloadRoot "worker\migration_v6.sql") (Join-Path $root "worker\migration_v6.sql")
}

Write-Host ""
Write-Host "INSTALLATION TERMINEE." -ForegroundColor Green
Write-Host "Lance maintenant DEPLOYER_V6_2.bat depuis ce meme dossier."
Read-Host "Appuie sur Entree"
