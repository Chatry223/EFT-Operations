Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'EFT Operations - Client Plugin Builder'
$form.Size = New-Object System.Drawing.Size(760, 560)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 26, 36)
$form.ForeColor = [System.Drawing.Color]::White

function Add-Label([string]$text, [int]$x, [int]$y, [int]$w, [int]$h) {
    $c = New-Object System.Windows.Forms.Label
    $c.Text = $text; $c.Location = New-Object System.Drawing.Point($x,$y)
    $c.Size = New-Object System.Drawing.Size($w,$h); $c.ForeColor = [System.Drawing.Color]::White
    $form.Controls.Add($c); return $c
}
function Add-TextBox([int]$x, [int]$y, [int]$w) {
    $c = New-Object System.Windows.Forms.TextBox
    $c.Location = New-Object System.Drawing.Point($x,$y); $c.Size = New-Object System.Drawing.Size($w,25)
    $c.ReadOnly = $true; $c.BackColor = [System.Drawing.Color]::FromArgb(31,42,56)
    $c.ForeColor = [System.Drawing.Color]::White; $form.Controls.Add($c); return $c
}
function Add-Button([string]$text, [int]$x, [int]$y, [int]$w, [int]$h) {
    $c = New-Object System.Windows.Forms.Button
    $c.Text = $text; $c.Location = New-Object System.Drawing.Point($x,$y)
    $c.Size = New-Object System.Drawing.Size($w,$h)
    $c.FlatStyle = 'Flat'; $c.BackColor = [System.Drawing.Color]::FromArgb(43,73,101)
    $c.ForeColor = [System.Drawing.Color]::White; $form.Controls.Add($c); return $c
}
function Write-Log([string]$message) {
    $logBox.AppendText($message + [System.Environment]::NewLine)
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
    [System.Windows.Forms.Application]::DoEvents()
}
function Resolve-ManagedDir([string]$selected) {
    if ([string]::IsNullOrWhiteSpace($selected)) { return $null }
    $candidates = @($selected,
        (Join-Path $selected 'EscapeFromTarkov_Data\Managed'),
        (Join-Path $selected 'EFT_Data\Managed'),
        (Join-Path $selected 'SPT_Data\Managed'),
        (Join-Path $selected 'Managed'))
    foreach ($candidate in $candidates) {
        if ((Test-Path (Join-Path $candidate 'UnityEngine.CoreModule.dll')) -and
            (Test-Path (Join-Path $candidate 'Assembly-CSharp.dll'))) { return $candidate }
    }
    return $null
}
function Resolve-BepInExCore([string]$selected) {
    if ([string]::IsNullOrWhiteSpace($selected)) { return $null }
    $candidates = @($selected, (Join-Path $selected 'BepInEx\core'), (Join-Path $selected 'core'))
    foreach ($candidate in $candidates) {
        if ((Test-Path (Join-Path $candidate 'BepInEx.dll')) -and
            (Test-Path (Join-Path $candidate '0Harmony.dll'))) { return $candidate }
    }
    return $null
}
function Resolve-InstallBepInExRoot([string]$selected) {
    if ([string]::IsNullOrWhiteSpace($selected)) { return $null }
    $candidates = @($selected, (Join-Path $selected 'BepInEx'), (Join-Path $selected 'BepInEx\core'),
        (Join-Path $selected 'core'), (Split-Path $selected -Parent))
    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        $full = [System.IO.Path]::GetFullPath($candidate)
        if ($full -match '[\\/]EFT-Operations[\\/]Dependencies([\\/]|$)') { continue }
        if ((Test-Path (Join-Path $full 'core\BepInEx.dll')) -and
            (Test-Path (Join-Path $full 'plugins'))) { return $full }
    }
    return $null
}
function Copy-ZipEntry([string]$zipPath, [string]$entrySuffix, [string]$destination) {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $entries = @($archive.Entries | Where-Object {
            $_.FullName.Replace('\','/').EndsWith($entrySuffix, [System.StringComparison]::OrdinalIgnoreCase)
        })
        if ($entries.Count -ne 1) {
            throw "Archive '$zipPath' must contain exactly one entry ending in '$entrySuffix'; found $($entries.Count)."
        }
        $parent = Split-Path -Parent $destination
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        $inputStream = $entries[0].Open()
        try {
            $outputStream = [System.IO.File]::Open($destination, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            try { $inputStream.CopyTo($outputStream) }
            finally { $outputStream.Dispose() }
        }
        finally { $inputStream.Dispose() }
    }
    finally { $archive.Dispose() }
}
function Load-BundledDependencies {
    $sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
    $eftZip = Join-Path $sourceRoot 'EscapeFromTarkov_Data.zip'
    $bepZip = Join-Path $sourceRoot 'BepInEx.zip'
    if (-not (Test-Path -LiteralPath $eftZip -PathType Leaf)) { throw "Bundled EFT archive not found: $eftZip" }
    if (-not (Test-Path -LiteralPath $bepZip -PathType Leaf)) { throw "Bundled BepInEx archive not found: $bepZip" }

    $eftHash = (Get-FileHash -LiteralPath $eftZip -Algorithm SHA256).Hash.Substring(0,12)
    $bepHash = (Get-FileHash -LiteralPath $bepZip -Algorithm SHA256).Hash.Substring(0,12)
    $localRoot = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:TEMP }
    $cacheRoot = Join-Path $localRoot ("EFT-Operations\Dependencies\" + $eftHash + "-" + $bepHash)
    $managed = Join-Path $cacheRoot 'EFT\Managed'
    $core = Join-Path $cacheRoot 'BepInEx\BepInEx\core'

    $gameFiles = @(
        'Managed/Assembly-CSharp.dll',
        'Managed/UnityEngine.dll',
        'Managed/UnityEngine.CoreModule.dll',
        'Managed/UnityEngine.IMGUIModule.dll',
        'Managed/UnityEngine.UnityWebRequestModule.dll',
        'Managed/UnityEngine.JSONSerializeModule.dll'
    )
    foreach ($entry in $gameFiles) {
        $destination = Join-Path $managed (Split-Path $entry -Leaf)
        if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) { Copy-ZipEntry $eftZip $entry $destination }
    }

    $bepFiles = @(
        'BepInEx/core/BepInEx.dll',
        'BepInEx/core/0Harmony.dll',
        'BepInEx/plugins/Fika.Core.dll',
        'BepInEx/plugins/spt/spt-common.dll',
        'BepInEx/config/com.fika.core.cfg'
    )
    foreach ($entry in $bepFiles) {
        $relative = $entry.Substring('BepInEx/'.Length).Replace('/', '\')
        $destination = Join-Path (Join-Path $cacheRoot 'BepInEx') $relative
        if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) { Copy-ZipEntry $bepZip $entry $destination }
    }
    return @{ ManagedDir = $managed; CoreDir = $core }
}
function Find-MSBuild {
    $cmd = Get-Command msbuild.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $programFilesX86 = [System.Environment]::GetFolderPath('ProgramFilesX86')
    if ([string]::IsNullOrWhiteSpace($programFilesX86)) { return $null }
    $vswhere = Join-Path $programFilesX86 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path $vswhere) {
        $vs = & $vswhere -latest -products '*' -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
        if ($vs -and (Test-Path $vs)) { return $vs }
    }
    return $null
}

Add-Label 'EFT Operations - Build and install the BepInEx client plugin' 22 18 700 30 | Out-Null
Add-Label 'Select EFT Managed (or game root); bundled source ZIPs can be loaded automatically:' 22 65 700 22 | Out-Null
$managedBox = Add-TextBox 22 90 590
$managedButton = Add-Button 'Browse...' 625 88 100 30
Add-Label 'Select BepInEx core (or BepInEx root) for references:' 22 135 700 22 | Out-Null
$coreBox = Add-TextBox 22 160 590
$coreButton = Add-Button 'Browse...' 625 158 100 30
Add-Label 'Select the actual installed BepInEx root (required for installation):' 22 205 700 22 | Out-Null
$installBox = Add-TextBox 22 230 590
$installButton = Add-Button 'Browse...' 625 228 100 30
$buildButton = Add-Button 'Build and Install DLL' 22 275 190 38
$bundledButton = Add-Button 'Load bundled ZIPs' 225 275 180 38
$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Location = New-Object System.Drawing.Point(22,325)
$logBox.Size = New-Object System.Drawing.Size(703,175)
$logBox.Multiline = $true; $logBox.ReadOnly = $true; $logBox.ScrollBars = 'Vertical'
$logBox.BackColor = [System.Drawing.Color]::FromArgb(10,16,23)
$logBox.ForeColor = [System.Drawing.Color]::FromArgb(210,225,240)
$form.Controls.Add($logBox)
$managedButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Choose EFT_Data\Managed or the EFT game folder'
    if ($dialog.ShowDialog() -eq 'OK') { $managedBox.Text = $dialog.SelectedPath }
})
$coreButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Choose BepInEx\core or the BepInEx folder'
    if ($dialog.ShowDialog() -eq 'OK') { $coreBox.Text = $dialog.SelectedPath }
})
$installButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Choose the actual installed BepInEx root (or the SPT game root)'
    if ($dialog.ShowDialog() -eq 'OK') { $installBox.Text = $dialog.SelectedPath }
})
$bundledButton.Add_Click({
    try {
        $dependencies = Load-BundledDependencies
        $managedBox.Text = $dependencies.ManagedDir
        if ([string]::IsNullOrWhiteSpace($coreBox.Text)) { $coreBox.Text = $dependencies.CoreDir }
        Write-Log 'Bundled EFT and BepInEx archives loaded into the local build cache.'
        Write-Log 'The actual game BepInEx install folder must still be selected below.'
        Write-Log ('EFT Managed: ' + $dependencies.ManagedDir)
        Write-Log ('BepInEx core: ' + $dependencies.CoreDir)
    } catch {
        Write-Log ('ERROR: ' + $_.Exception.Message)
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'EFT Operations - Dependency load failed',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    }
})
$buildButton.Add_Click({
    $buildButton.Enabled = $false
    try {
        $managed = Resolve-ManagedDir $managedBox.Text
        $core = Resolve-BepInExCore $coreBox.Text
        if (-not $managed -or -not $core) {
            $dependencies = Load-BundledDependencies
            if (-not $managed) { $managed = $dependencies.ManagedDir; $managedBox.Text = $managed }
            if (-not $core) { $core = $dependencies.CoreDir; $coreBox.Text = $core }
            Write-Log 'No complete local dependency selection found; using the bundled source ZIPs.'
        }
        if (-not $managed) { throw 'EFT Managed folder was not found. Choose the folder containing Assembly-CSharp.dll and UnityEngine.CoreModule.dll.' }
        if (-not $core) { throw 'BepInEx core folder was not found. Choose the folder containing BepInEx.dll and 0Harmony.dll.' }
        if ([string]::IsNullOrWhiteSpace($installBox.Text) -and $managed -notmatch '[\\/]EFT-Operations[\\/]Dependencies([\\/]|$)') {
            $gameRoot = Split-Path (Split-Path $managed -Parent) -Parent
            $candidateRoot = Join-Path $gameRoot 'BepInEx'
            if (Test-Path (Join-Path $candidateRoot 'core\BepInEx.dll')) { $installBox.Text = $candidateRoot }
        }
        $installRoot = Resolve-InstallBepInExRoot $installBox.Text
        if (-not $installRoot) { throw 'Select the actual installed BepInEx root in the third field. Do not install the DLL into the temporary build cache.' }
        $project = Join-Path $PSScriptRoot 'EFT.Operations.Client.csproj'
        if (-not (Test-Path $project)) { throw 'EFT.Operations.Client.csproj is missing.' }
        $msbuild = Find-MSBuild
        if (-not $msbuild) { throw 'MSBuild was not found. Install Visual Studio with the .NET desktop development workload and .NET Framework 4.7.2 targeting pack.' }

        $requiredGame = @('Assembly-CSharp.dll','UnityEngine.dll','UnityEngine.CoreModule.dll','UnityEngine.IMGUIModule.dll','UnityEngine.UnityWebRequestModule.dll','UnityEngine.JSONSerializeModule.dll')
        foreach ($name in $requiredGame) { if (-not (Test-Path (Join-Path $managed $name))) { throw "Missing EFT reference: $name" } }
        $bepInExRoot = Split-Path $core -Parent
        $fikaDll = Join-Path $bepInExRoot 'plugins\Fika.Core.dll'
        $sptCommonDll = Join-Path $bepInExRoot 'plugins\spt\spt-common.dll'
        $fikaConfig = Join-Path $bepInExRoot 'config\com.fika.core.cfg'
        foreach ($dependency in @($fikaDll,$sptCommonDll,$fikaConfig)) {
            if (-not (Test-Path -LiteralPath $dependency -PathType Leaf)) { throw "Missing required target dependency: $dependency" }
        }

        $expectedHashes = @{
            'Assembly-CSharp.dll' = '12d5fd1728c58a9cd71a454fb5eae506b5a0a3c2bb35d543c4022800e10f47d5'
            'Fika.Core.dll' = '246d45e0f9ef445484802379383cb8bb52901d013a1e244ba2209048c7dce65a'
            'spt-common.dll' = '970dab34fa09f8c6930f5011aae4025d1f2dc4874a27ff0b3cd7da06899b964f'
        }
        $hashPaths = @{
            'Assembly-CSharp.dll' = Join-Path $managed 'Assembly-CSharp.dll'
            'Fika.Core.dll' = $fikaDll
            'spt-common.dll' = $sptCommonDll
        }
        foreach ($name in $expectedHashes.Keys) {
            $actualHash = (Get-FileHash -LiteralPath $hashPaths[$name] -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actualHash -ne $expectedHashes[$name]) {
                throw "Wrong target dependency '$name'. Expected the verified EFT 0.16.1.3.35392 / SPT 3.11.1 / Fika client 1.2.3 file hash; got $actualHash."
            }
        }
        $bepinexVersion = [Reflection.AssemblyName]::GetAssemblyName((Join-Path $core 'BepInEx.dll')).Version.ToString()
        $fikaVersion = [System.Reflection.AssemblyName]::GetAssemblyName($fikaDll).Version.ToString()
        $sptCommonVersion = [Reflection.AssemblyName]::GetAssemblyName($sptCommonDll).Version.ToString()
        if ($bepinexVersion -ne '5.4.22.0') { throw "Expected BepInEx 5.4.22.0; found $bepinexVersion" }
        if ($fikaVersion -ne '1.2.3.0') { throw "Expected Fika.Core 1.2.3.0; found $fikaVersion" }
        if ($sptCommonVersion -ne '3.11.1.0') { throw "Expected SPT.Common 3.11.1.0; found $sptCommonVersion" }
        $fikaHeader = Get-Content -LiteralPath $fikaConfig -TotalCount 2 -ErrorAction Stop | Select-Object -First 1
        if ($fikaHeader -notmatch 'Fika\.Core v1\.2\.3') { throw "Expected Fika client 1.2.3 config marker; found: $fikaHeader" }
        $gameAssemblyVersion = [Reflection.AssemblyName]::GetAssemblyName((Join-Path $managed 'Assembly-CSharp.dll')).Version.ToString()

        Write-Log 'Exact target EFT/SPT/Fika dependency fingerprints verified.'
        Write-Log "EFT references: $managed"
        Write-Log "Assembly-CSharp assembly version: $gameAssemblyVersion"
        Write-Log "BepInEx references: $core"
        Write-Log "BepInEx: $bepinexVersion; Fika.Core: $fikaVersion; SPT.Common: $sptCommonVersion"
        Write-Log "MSBuild: $msbuild"
        Write-Log 'Building Release / net472...'
        $output = & $msbuild $project '/restore' '/m' '/p:Configuration=Release' "/p:GameManagedDir=$managed" "/p:BepInExCoreDir=$core" '/verbosity:minimal' 2>&1
        foreach ($line in $output) { Write-Log ([string]$line) }
        if ($LASTEXITCODE -ne 0) { throw "MSBuild failed with exit code $LASTEXITCODE." }
        $dll = Join-Path $PSScriptRoot 'bin\Release\net472\EFTOperations.Client.dll'
        if (-not (Test-Path $dll)) { throw 'Build finished without producing EFTOperations.Client.dll.' }

        $pluginDir = Join-Path $installRoot 'plugins\EFTOperations'
        New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
        $destination = Join-Path $pluginDir 'EFTOperations.Client.dll'
        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            $backup = $destination + '.before-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bak'
            Copy-Item -LiteralPath $destination -Destination $backup -ErrorAction Stop
            Write-Log "Previous plugin backed up: $backup"
        }
        Copy-Item -LiteralPath $dll -Destination $destination -Force -ErrorAction Stop
        $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        $gameHash = (Get-FileHash -LiteralPath (Join-Path $managed 'Assembly-CSharp.dll') -Algorithm SHA256).Hash
        $fikaHash = (Get-FileHash -LiteralPath $fikaDll -Algorithm SHA256).Hash
        $sptHash = (Get-FileHash -LiteralPath $sptCommonDll -Algorithm SHA256).Hash
        $report = @("Build time: $(Get-Date -Format o)", "Target: EFT 0.16.1.3.35392-P2P / SPT 3.11.1 / Fika Server 2.4.3 / Fika Client 1.2.3", "Target: net472", "EFT Managed: $managed", "BepInEx core references: $core", "Installed BepInEx root: $installRoot", "Assembly-CSharp SHA256: $gameHash", "Fika.Core SHA256: $fikaHash", "spt-common SHA256: $sptHash", "DLL: $destination", "SHA256: $hash")
        Set-Content -LiteralPath (Join-Path $pluginDir 'build-report.txt') -Value $report -Encoding UTF8
        Write-Log "SUCCESS: Installed $destination"
        Write-Log "Target BepInEx root: $installRoot"
        Write-Log "SHA256: $hash"
        [System.Windows.Forms.MessageBox]::Show(("Build and installation completed." + [Environment]::NewLine + [Environment]::NewLine + $destination + [Environment]::NewLine + [Environment]::NewLine + "SHA256: " + $hash),'EFT Operations',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } catch {
        Write-Log ('ERROR: ' + $_.Exception.Message)
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'EFT Operations - Build failed',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    } finally { $buildButton.Enabled = $true }
})
Write-Log 'Load bundled ZIPs for exact build references, then choose the actual BepInEx install root before building.'
[void]$form.ShowDialog()
