param([string]$NodePath)
$ErrorActionPreference = 'Stop'
$mutex = [Threading.Mutex]::new($false, 'Local\CodexUsageCardWindows.SidebarLauncher')
try {
    if (-not $mutex.WaitOne(0)) { return }
} catch [Threading.AbandonedMutexException] {}
try {
    $package = Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
    if (-not $package) { throw '找不到 Windows 版 Codex。' }
    $client = Join-Path $package.InstallLocation 'app\ChatGPT.exe'

    $codex = Join-Path $package.InstallLocation 'app\resources\codex.exe'
    $running = Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -like '*\WindowsApps\OpenAI.Codex_*\app\ChatGPT.exe'
    }
    if ($running) { throw '请先保存工作，并从 Codex 菜单或系统托盘完全退出客户端，再打开「Codex（侧栏额度）」入口。' }
    & $NodePath (Join-Path $PSScriptRoot 'sidebar.cjs') $client $codex (Join-Path $PSScriptRoot 'BrowserProfile')
    if ($LASTEXITCODE -ne 0) { throw 'Codex 侧栏额度启动失败。请确认所有 Codex 窗口和托盘进程已退出后再试。' }
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Codex Usage Card')
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}



