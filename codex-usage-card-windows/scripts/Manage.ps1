param([ValidateSet('Install','Uninstall')][string]$Action = 'Install')
$ErrorActionPreference = 'Stop'
# Packaged Codex can redirect LocalAppData writes into its private LocalCache.
# The Start Menu launcher runs outside that package.
$destination = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex-usage-card-windows'
$programs = [Environment]::GetFolderPath('Programs')
$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $programs 'Codex（侧栏额度）.lnk'
$files = 'Launch-Codex.ps1', 'sidebar.cjs', 'quota.cjs'
function Stop-Card {
    try {
        $signal = [Threading.EventWaitHandle]::OpenExisting('Local\CodexUsageCardWindows.Stop')
    } catch [Threading.WaitHandleCannotBeOpenedException] { return }
    try {
        $instance = [Threading.Mutex]::OpenExisting('Local\CodexUsageCardWindows.Instance')
    } catch [Threading.WaitHandleCannotBeOpenedException] {
        $signal.Dispose()
        return
    }
    try {
        [void]$signal.Set()
        try {
            if (-not $instance.WaitOne(5000)) { throw 'Usage Card did not exit. Close it from the tray and retry.' }
            $instance.ReleaseMutex()
        } catch [Threading.AbandonedMutexException] { $instance.ReleaseMutex() }
    } finally {
        $instance.Dispose()
        $signal.Dispose()
    }
}

if ($Action -eq 'Install') {
    $node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
    $package = Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
    if (-not $package) { throw '找不到 Windows 版 Codex。' }
    $codex = Join-Path $package.InstallLocation 'app\resources\codex.exe'
    if (-not (Test-Path -LiteralPath $codex -PathType Leaf)) { throw '找不到 Codex 应用包自带的 CLI。' }
    Stop-Card
    foreach ($legacy in @(
        (Join-Path $programs 'Codex Usage Card.lnk'),
        (Join-Path $startup 'Codex Usage Card.lnk'),
        (Join-Path $destination 'UsageCard.ps1')
    )) {
        if (Test-Path -LiteralPath $legacy) { Remove-Item -LiteralPath $legacy }
    }

    [void](New-Item -ItemType Directory -Path $destination -Force)
    foreach ($file in $files) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $destination -Force
    }
    $launcher = Join-Path $destination 'Launch-Codex.ps1'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" -NodePath `"$node`""
    $shortcut.WorkingDirectory = $destination
    $shortcut.IconLocation = (Join-Path $package.InstallLocation 'app\ChatGPT.exe') + ',0'
    $shortcut.Save()
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
        throw "找不到已安装的启动脚本：$launcher"
    }
    Write-Output "已安装开始菜单入口：$link"
} else {
    $mutex = [Threading.Mutex]::new($false, 'Local\CodexUsageCardWindows.SidebarLauncher')
    try {
        try {
            if (-not $mutex.WaitOne(0)) { throw '请完全退出通过侧栏入口打开的 Codex，再运行卸载。' }
        } catch [Threading.AbandonedMutexException] {}
        foreach ($file in (@($link) + @($files | ForEach-Object { Join-Path $destination $_ }))) {
            if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
        }
        if ((Test-Path -LiteralPath $destination) -and -not (Get-ChildItem -LiteralPath $destination -Force)) {
            Remove-Item -LiteralPath $destination
        }
        $mutex.ReleaseMutex()
    } finally { $mutex.Dispose() }
}

