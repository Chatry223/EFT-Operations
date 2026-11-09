[CmdletBinding()]
param([string]$SptRoot = "")
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($SptRoot)) {
    $SptRoot = (Get-Item $PSScriptRoot).Parent.Parent.Parent.Parent.FullName
}
$SptRoot = (Resolve-Path $SptRoot).Path
$ModsPath = Join-Path $SptRoot 'user\mods'
$DataPath = Join-Path $SptRoot 'SPT-EconomyGuard-Data\backups\legacy-order'
if (-not (Test-Path $ModsPath)) { throw "SPT user\mods folder not found: $ModsPath" }
$files = @(Get-ChildItem -Path $ModsPath -File -Filter 'order.json.economyguard-*.bak')
if ($files.Count -eq 0) { Write-Host 'No legacy order.json backups found in user\mods.' -ForegroundColor Green; exit 0 }
New-Item -ItemType Directory -Path $DataPath -Force | Out-Null
foreach ($file in $files) {
    $destination = Join-Path $DataPath $file.Name
    if (Test-Path $destination) {
        $destination = Join-Path $DataPath ($file.BaseName + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + $file.Extension)
    }
    Move-Item -LiteralPath $file.FullName -Destination $destination
    Write-Host "Moved: $($file.Name)" -ForegroundColor Cyan
}
Write-Host "Moved $($files.Count) backup file(s). No backup was deleted and order.json was not modified." -ForegroundColor Green
