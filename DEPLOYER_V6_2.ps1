$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Deploiement OpiumStore V6.2 ===" -ForegroundColor Cyan

$Base = Join-Path $env:USERPROFILE "Documents\OpiumStore_Fullstack"

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
    Write-Host "ERREUR : aucun projet Worker trouve." -ForegroundColor Red
    Read-Host "Appuie sur Entree"
    exit 1
}

$deployRoot = $null
$outer = $Base
if ((Test-Path -LiteralPath (Join-Path $outer "worker\package.json")) -and
    (Test-Path -LiteralPath (Join-Path $outer "worker\wrangler.toml"))) {
    $deployRoot = (Resolve-Path -LiteralPath $outer).Path
}
if (-not $deployRoot) {
    foreach ($root in $roots) {
        if (Test-Path -LiteralPath (Join-Path $root "worker\wrangler.toml")) {
            $deployRoot = $root
            break
        }
    }
}
if (-not $deployRoot) {
    Write-Host "ERREUR : wrangler.toml introuvable dans les Workers detectes." -ForegroundColor Red
    Read-Host "Appuie sur Entree"
    exit 1
}

$worker = Join-Path $deployRoot "worker"
foreach ($required in @("package.json","wrangler.toml","migration_v5.sql","migration_v6.sql","src\index.js")) {
    $full = Join-Path $worker $required
    if (-not (Test-Path -LiteralPath $full)) {
        Write-Host "ERREUR : fichier manquant : $full" -ForegroundColor Red
        Write-Host "Relance d'abord INSTALLER_V6_2.bat."
        Read-Host "Appuie sur Entree"
        exit 1
    }
}

function Run-Step {
    param([string]$Title, [scriptblock]$Command)
    Write-Host ""
    Write-Host $Title -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "La commande a echoue avec le code $LASTEXITCODE" }
}

Write-Host "Worker deploye depuis :" -ForegroundColor Cyan
Write-Host $worker

Push-Location $worker
try {
    Run-Step "[1/4] Migration V5" { & npx.cmd wrangler d1 execute opiumstore-db --remote --file=.\migration_v5.sql }
    Run-Step "[2/4] Migration V6" { & npx.cmd wrangler d1 execute opiumstore-db --remote --file=.\migration_v6.sql }
    Run-Step "[3/4] Installation et deploiement Worker" {
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) { return }
        & npm.cmd run deploy
    }
} finally { Pop-Location }

Write-Host ""
Write-Host "[4/4] GitHub" -ForegroundColor Cyan
$gitRoot = (& git -C $Base rev-parse --show-toplevel 2>$null).Trim()
if (-not $gitRoot) { throw "Depot Git introuvable depuis $Base" }

$trackedRoot = $null
$g = (Resolve-Path -LiteralPath $gitRoot).Path.TrimEnd("\")
foreach ($root in $roots) {
    $r = (Resolve-Path -LiteralPath $root).Path.TrimEnd("\")
    if (-not $r.StartsWith($g, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
    $prefix = $r.Substring($g.Length).TrimStart("\")
    $testPath = if ($prefix) { "$prefix\frontend\app.js" } else { "frontend\app.js" }
    $tracked = & git -C $gitRoot ls-files -- $testPath 2>$null
    if ($tracked) { $trackedRoot = $root; break }
}
if (-not $trackedRoot) { $trackedRoot = $roots[0] }

$r = (Resolve-Path -LiteralPath $trackedRoot).Path.TrimEnd("\")
$prefix = $r.Substring($g.Length).TrimStart("\")
$paths = @("frontend\app.js","frontend\index.html","worker\src\index.js","worker\migration_v5.sql","worker\migration_v6.sql") | ForEach-Object {
    if ($prefix) { "$prefix\$_" } else { $_ }
}

& git -C $gitRoot add -- $paths
if ($LASTEXITCODE -ne 0) { throw "git add a echoue." }

& git -C $gitRoot diff --cached --quiet
$diffCode = $LASTEXITCODE
if ($diffCode -eq 1) {
    & git -C $gitRoot commit -m "VIP et limites journalieres V6.2"
    if ($LASTEXITCODE -ne 0) { throw "git commit a echoue." }
} elseif ($diffCode -ne 0) { throw "git diff a echoue." } else { Write-Host "Aucun nouveau changement a commit." }

& git -C $gitRoot push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Le Worker est deploye, mais GitHub a refuse le push." -ForegroundColor Yellow
    Write-Host "Execute ensuite :"
    Write-Host "git -C `"$gitRoot`" pull --rebase origin main"
    Write-Host "git -C `"$gitRoot`" push origin main"
    Read-Host "Appuie sur Entree"
    exit 1
}

Write-Host ""
Write-Host "DEPLOIEMENT TERMINE." -ForegroundColor Green
Write-Host "Verification :"
Write-Host "https://opiumstore-api.opiumstore.workers.dev/health?v=62"
Read-Host "Appuie sur Entree"
