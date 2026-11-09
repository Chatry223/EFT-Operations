[CmdletBinding()]
param(
    [string]$SptRoot = "",
    [switch]$DisableFikaItemSending
)

$ErrorActionPreference = 'Stop'
$ModFolderName = 'SPT-EconomyGuard'

if ([string]::IsNullOrWhiteSpace($SptRoot)) {
    # Script path: <SPT root>\user\mods\SPT-EconomyGuard\tools
    $SptRoot = (Get-Item $PSScriptRoot).Parent.Parent.Parent.Parent.FullName
}
$SptRoot = (Resolve-Path $SptRoot).Path
$ModsPath = Join-Path $SptRoot 'user\mods'
$ModPath = Join-Path $ModsPath $ModFolderName
$OrderPath = Join-Path $ModsPath 'order.json'
$DataPath = Join-Path $SptRoot 'SPT-EconomyGuard-Data'

if (-not (Test-Path $ModPath)) { throw "Mod folder not found: $ModPath. Extract the ZIP into the SPT root first." }
if (-not (Test-Path $ModsPath)) { throw "SPT user\mods folder not found: $ModsPath" }

Write-Host "SPT root: $SptRoot" -ForegroundColor Cyan

# Keep installer backups OUTSIDE user/mods and avoid creating a new backup when the order is already correct.
New-Item -ItemType Directory -Path $DataPath -Force | Out-Null
$BackupPath = Join-Path $DataPath 'backups\order'

if (Test-Path $OrderPath) {
    $raw = Get-Content -Raw -Path $OrderPath
    $obj = $raw | ConvertFrom-Json
} else {
    $raw = ''
    $obj = [pscustomobject]@{ order = @() }
}

if ($null -eq $obj.order) { $obj | Add-Member -NotePropertyName order -NotePropertyValue @() -Force }
$existingFolders = @(Get-ChildItem -Path $ModsPath -Directory | Select-Object -ExpandProperty Name)
$previous = @($obj.order | Where-Object { $_ -and $_ -ne $ModFolderName -and $existingFolders -contains $_ } | Select-Object -Unique)
$unlisted = @($existingFolders | Where-Object { $_ -ne $ModFolderName -and $previous -notcontains $_ } | Sort-Object)
$newOrder = @($previous + $unlisted + $ModFolderName)
$oldOrder = @($obj.order)
$orderChanged = (($oldOrder -join "`n") -ne ($newOrder -join "`n"))

if ($orderChanged -or -not (Test-Path $OrderPath)) {
    if (Test-Path $OrderPath) {
        New-Item -ItemType Directory -Path $BackupPath -Force | Out-Null
        $backup = Join-Path $BackupPath ("order.json.economyguard-" + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.bak')
        Copy-Item $OrderPath $backup
        Write-Host "Order backup saved outside mods: $backup" -ForegroundColor DarkCyan
    }
    $obj.order = $newOrder
    $orderJson = $obj | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($OrderPath, $orderJson, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Updated mod order: $ModFolderName is last." -ForegroundColor Green
} else {
    Write-Host 'Mod order already correct; no backup created and no file rewritten.' -ForegroundColor Green
}

New-Item -ItemType Directory -Path $DataPath -Force | Out-Null
foreach ($folder in @('logs','ledger','cases','reports','policies','policies\usage','backups')) {
    New-Item -ItemType Directory -Path (Join-Path $DataPath $folder) -Force | Out-Null
}
Write-Host "Created external data directory: $DataPath" -ForegroundColor Green

if ($DisableFikaItemSending) {
    $FikaConfig = Join-Path $SptRoot 'user\mods\fika-server\assets\configs\fika.jsonc'
    if (-not (Test-Path $FikaConfig)) {
        Write-Warning "Fika config not found at $FikaConfig; Item Sending was not changed."
    } else {
        $fikaText = Get-Content -Raw -Path $FikaConfig
        if ($fikaText -match '"allowItemSending"\s*:\s*false') {
            Write-Host "Fika Item Sending is already disabled; no backup created." -ForegroundColor Green
        } elseif ($fikaText -match '"allowItemSending"\s*:\s*true') {
            $fikaBackupDir = Join-Path $DataPath 'backups\fika'
            New-Item -ItemType Directory -Path $fikaBackupDir -Force | Out-Null
            $fikaBackup = Join-Path $fikaBackupDir ("fika.jsonc.economyguard-" + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.bak')
            Copy-Item $FikaConfig $fikaBackup
            $updated = [regex]::Replace($fikaText, '("allowItemSending"\s*:\s*)true', '${1}false', 1)
            [System.IO.File]::WriteAllText($FikaConfig, $updated, [System.Text.UTF8Encoding]::new($false))
            Write-Host "Fika Item Sending disabled; backup saved outside mods: $fikaBackup" -ForegroundColor Green
        } else {
            Write-Warning "allowItemSending setting was not found or was not a simple boolean. Edit it manually and set it to false."
        }
    }
} else {
    Write-Warning "Fika Item Sending remains unchanged and is NOT protected by this build. Disable allowItemSending manually or rerun with -DisableFikaItemSending."
}

Write-Host "Install preparation complete. Start SPT and inspect SPT-EconomyGuard-Data\health.json." -ForegroundColor Green
