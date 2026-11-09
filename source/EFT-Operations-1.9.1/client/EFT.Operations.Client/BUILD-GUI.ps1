Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'EFT Operations - Client Plugin Builder'
$form.Size = New-Object System.Drawing.Size(760, 500)
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
    $logBox.AppendText($message + [Environment]::NewLine)
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
function Find-MSBuild {
    $cmd = Get-Command msbuild.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
    if ([string]::IsNullOrWhiteSpace($programFilesX86)) { return $null }
    $vswhere = Join-Path $programFilesX86 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path $vswhere) {
        $vs = & $vswhere -latest -products '*' -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
        if ($vs -and (Test-Path $vs)) { return $vs }
    }
    return $null
}

Add-Label 'EFT Operations - Build and install the BepInEx client plugin' 22 18 700 30 | Out-Null
Add-Label 'Select the EFT Managed folder (or the game root containing it):' 22 65 700 22 | Out-Null
$managedBox = Add-TextBox 22 90 590
$managedButton = Add-Button 'Browse...' 625 88 100 30
Add-Label 'Select the BepInEx core folder (or the BepInEx root):' 22 135 700 22 | Out-Null
$coreBox = Add-TextBox 22 160 590
$coreButton = Add-Button 'Browse...' 625 158 100 30
$buildButton = Add-Button 'Build and Install DLL' 22 207 190 38
$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Location = New-Object System.Drawing.Point(22,260)
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
$buildButton.Add_Click({
    $buildButton.Enabled = $false
    try {
        $managed = Resolve-ManagedDir $managedBox.Text
        $core = Resolve-BepInExCore $coreBox.Text
        if (-not $managed) { throw 'EFT Managed folder was not found. Choose the folder containing Assembly-CSharp.dll and UnityEngine.CoreModule.dll.' }
        if (-not $core) { throw 'BepInEx core folder was not found. Choose the folder containing BepInEx.dll and 0Harmony.dll.' }
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
        $fikaVersion = [Reflection.AssemblyName]::GetAssemblyName($fikaDll).Version.ToString()
        $sptCommonVersion = [Reflection.AssemblyName]::GetAssemblyName($sptCommonDll).Version.ToString()
        if ($fikaVersion -ne '1.2.3.0') { throw "Expected Fika.Core 1.2.3.0; found $fikaVersion" }
        if ($sptCommonVersion -ne '3.11.1.0') { throw "Expected SPT.Common 3.11.1.0; found $sptCommonVersion" }
        $fikaHeader = Get-Content -LiteralPath $fikaConfig -TotalCount 2 -ErrorAction Stop | Select-Object -First 1
        if ($fikaHeader -notmatch 'Fika\.Core v1\.2\.3') { throw "Expected Fika client 1.2.3 config marker; found: $fikaHeader" }
        $gameAssemblyVersion = [Reflection.AssemblyName]::GetAssemblyName((Join-Path $managed 'Assembly-CSharp.dll')).Version.ToString()
        Write-Log "EFT references: $managed"
        Write-Log "Assembly-CSharp assembly version: $gameAssemblyVersion"
        Write-Log "BepInEx references: $core"
        Write-Log "Fika.Core: $fikaVersion; SPT.Common: $sptCommonVersion"
        Write-Log "MSBuild: $msbuild"
        Write-Log 'Building Release / net472...'
        $output = & $msbuild $project '/m' '/p:Configuration=Release' "/p:GameManagedDir=$managed" "/p:BepInExCoreDir=$core" '/verbosity:minimal' 2>&1
        foreach ($line in $output) { Write-Log ([string]$line) }
        if ($LASTEXITCODE -ne 0) { throw "MSBuild failed with exit code $LASTEXITCODE." }
        $dll = Join-Path $PSScriptRoot 'bin\Release\net472\EFTOperations.Client.dll'
        if (-not (Test-Path $dll)) { throw 'Build finished without producing EFTOperations.Client.dll.' }
        $pluginDir = Join-Path (Split-Path $core -Parent) 'plugins\EFTOperations'
        New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
        $destination = Join-Path $pluginDir 'EFTOperations.Client.dll'
        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            $backup = $destination + '.before-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bak'
            Copy-Item -LiteralPath $destination -Destination $backup -ErrorAction Stop
            Write-Log "Previous plugin backed up: $backup"
        }
        Copy-Item -LiteralPath $dll -Destination $destination -Force -ErrorAction Stop
        $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        $report = @("Build time: $(Get-Date -Format o)", "Target: net472", "EFT Managed: $managed", "BepInEx core: $core", "DLL: $destination", "SHA256: $hash")
        Set-Content -LiteralPath (Join-Path $pluginDir 'build-report.txt') -Value $report -Encoding UTF8
        Write-Log "SUCCESS: Installed $destination"
        Write-Log "SHA256: $hash"
        [System.Windows.Forms.MessageBox]::Show(("Build and installation completed." + [Environment]::NewLine + [Environment]::NewLine + $destination + [Environment]::NewLine + [Environment]::NewLine + "SHA256: " + $hash),'EFT Operations',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } catch {
        Write-Log ('ERROR: ' + $_.Exception.Message)
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'EFT Operations - Build failed',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    } finally { $buildButton.Enabled = $true }
})
Write-Log 'Choose the two folders, then click Build and Install DLL.'
[void]$form.ShowDialog()
