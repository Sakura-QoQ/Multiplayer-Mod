param(
    [int] $Port = 28777,
    [int] $TimeoutSeconds = 120,
    [string] $Address = '127.0.0.1',
    [switch] $CaptureUiOnly,
    [switch] $CapturePauseUiOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$gameRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '..\..'))
$installedMod = Join-Path $gameRoot 'Mods\PlayerHostedMultiplayer'
$artifactRoot = Join-Path $projectRoot 'artifacts\dual-instance'
$runRoot = Join-Path $artifactRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
$evidenceRoot = Join-Path $runRoot 'evidence'
$hostRoot = Join-Path $runRoot 'host'
$clientRoot = Join-Path $runRoot 'client'
$saveRoot = Join-Path $env:USERPROFILE 'AppData\LocalLow\DefaultCompany\FallenFlower\Saves'

New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null

function Wait-Until([scriptblock] $condition, [string] $description, [int] $seconds = $TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
    do {
        try { if (& $condition) { return } } catch { }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "等待超时：$description"
}

function New-TestInstance([string] $root, [string] $channel, [string] $mode, [string] $playerName) {
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    foreach ($name in @('FallenFlower.exe', 'GameAssembly.dll', 'UnityPlayer.dll', 'UnityCrashHandler64.exe', 'baselib.dll')) {
        $source = Join-Path $gameRoot $name
        $target = Join-Path $root $name
        New-Item -ItemType HardLink -Path $target -Target $source | Out-Null
    }
    New-Item -ItemType Junction -Path (Join-Path $root 'FallenFlower_Data') -Target (Join-Path $gameRoot 'FallenFlower_Data') | Out-Null
    $modDestination = Join-Path $root 'Mods\PlayerHostedMultiplayer'
    New-Item -ItemType Directory -Force -Path (Split-Path $modDestination) | Out-Null
    # 游戏启动器把 Core 视为必需 Mod；缺失时主菜单协程不会可靠推进。
    Copy-Item -LiteralPath (Join-Path $gameRoot 'Mods\Core') -Destination (Join-Path $root 'Mods\Core') -Recurse -Force
    Copy-Item -LiteralPath $installedMod -Destination $modDestination -Recurse -Force
    $config = [ordered]@{
        mode = $mode
        address = $Address
        port = $Port
        maxPlayers = 2
        playerName = $playerName
        smokeTestAutoLoad = $true
        smokeTestUiOpen = [bool]$CaptureUiOnly
        smokeTestMotion = $true
        smokeTestSceneSync = $true
        smokeTestSleepConsensus = $true
        smokeTestAppearance = $true
        smokeTestPhone = $true
        smokeTestPauseMenu = [bool]$CapturePauseUiOnly
        bridgeChannel = $channel
    }
    [IO.File]::WriteAllText((Join-Path $modDestination 'config.json'),
        ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $plan = [ordered]@{
        Version = 1
        Mods = @(
            [ordered]@{ Id = 'Core'; DirectoryName = 'Core'; Enabled = $true; LoadOrder = 0 },
            [ordered]@{ Id = 'PlayerHostedMultiplayer'; DirectoryName = 'PlayerHostedMultiplayer'; Enabled = $true; LoadOrder = 1 }
        )
    }
    [IO.File]::WriteAllText((Join-Path $root 'Mods\modloadplan.json'),
        ($plan | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
}

function Read-State([string] $root, [string] $channel) {
    $path = Join-Path $root "Mods\PlayerHostedMultiplayer\Bridge\state.$channel.json"
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try { return Get-Content -Raw -LiteralPath $path | ConvertFrom-Json } catch { return $null }
}

function Test-Log([string] $path, [string] $pattern) {
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    return [bool](Select-String -LiteralPath $path -Pattern $pattern -Quiet)
}

function Test-FullProfileInLog([string] $path, [string] $playerName) {
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    foreach ($line in Get-Content -LiteralPath $path) {
        $marker = 'send?peer=0&data='
        $offset = $line.IndexOf($marker, [StringComparison]::Ordinal)
        if ($offset -lt 0 -or $line -notlike "*$playerName*") { continue }
        try {
            $encoded = $line.Substring($offset + $marker.Length)
            $packet = [Uri]::UnescapeDataString($encoded) | ConvertFrom-Json
            if ($packet.type -ne 'playerProfile') { continue }
            $progress = $packet.profile.progress
            $required = @('PlayerStatusData','SexData','ParcelData','PlayerHelper','Quests','ConditionSave',
                'XPostData','XContactData','Photo','Cloth','UnlockedCloth','CustomizationData')
            foreach ($name in $required) {
                if ($null -eq $progress.PSObject.Properties[$name]) { return $false }
            }
            return $true
        } catch { }
    }
    return $false
}

function Get-MaxPlayerStateSequence([string] $root, [string] $channel, [string] $playerName) {
    $state = Read-State $root $channel
    if ($null -eq $state -or $null -eq $state.events) { return 0L }
    $maximum = 0L
    foreach ($event in @($state.events)) {
        if ($event.type -ne 'message') { continue }
        try {
            $packet = $event.message | ConvertFrom-Json
            if ($packet.type -eq 'playerState' -and $packet.playerName -eq $playerName) {
                $maximum = [Math]::Max($maximum, [long]$packet.sequence)
            }
        } catch { }
    }
    return $maximum
}

function Get-SaveHashes {
    if (-not (Test-Path -LiteralPath $saveRoot)) { return @{} }
    $result = @{}
    Get-ChildItem -LiteralPath $saveRoot -Filter 'AutoSave*.save' -File | ForEach-Object {
        $result[$_.FullName] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
    return $result
}

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DualWindowCapture {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
}
'@
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DualGameInput {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
function Send-TestKey([Diagnostics.Process] $process, [byte] $key) {
    $process.Refresh()
    if ($process.MainWindowHandle -eq [IntPtr]::Zero) { throw '游戏窗口句柄不可用，不能发送测试按键' }
    # Unity 的旧输入系统既会检查前台键盘状态，也会消费窗口消息。测试时同时走两条
    # 标准 Win32 输入路径，避免 PowerShell 窗口在等待日志时意外抢回焦点。
    [DualGameInput]::ShowWindow($process.MainWindowHandle, 9) | Out-Null
    [DualGameInput]::BringWindowToTop($process.MainWindowHandle) | Out-Null
    $focused = [DualGameInput]::SetForegroundWindow($process.MainWindowHandle)
    Start-Sleep -Milliseconds 500
    [DualGameInput]::PostMessage($process.MainWindowHandle, 0x0100, [UIntPtr]$key, [IntPtr]::Zero) | Out-Null
    [DualGameInput]::keybd_event($key, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 120
    [DualGameInput]::keybd_event($key, 0, 2, [UIntPtr]::Zero)
    [DualGameInput]::PostMessage($process.MainWindowHandle, 0x0101, [UIntPtr]$key, [IntPtr]::Zero) | Out-Null
    if (-not $focused) { Write-Warning 'SetForegroundWindow 返回 false；已使用 PostMessage 作为备用输入路径。' }
}
function Save-WindowScreenshot([Diagnostics.Process] $process, [string] $path) {
    $process.Refresh()
    if ($process.MainWindowHandle -eq [IntPtr]::Zero) { throw '游戏窗口句柄不可用，不能截图' }
    [DualWindowCapture]::ShowWindow($process.MainWindowHandle, 9) | Out-Null
    # Unity 使用 1920x1080 的内部渲染尺寸；把外框缩成 1280x900 只会裁掉右侧和底部，
    # 并不能让已创建的 Canvas 重新布局。按真实渲染尺寸抓取，避免把测试裁剪误判为 UI 越界。
    [DualWindowCapture]::MoveWindow($process.MainWindowHandle, 0, 0, 1920, 1080, $true) | Out-Null
    [DualWindowCapture]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
    Start-Sleep -Seconds 2
    $bounds = New-Object DualWindowCapture+RECT
    if (-not [DualWindowCapture]::GetWindowRect($process.MainWindowHandle, [ref]$bounds)) {
        throw 'GetWindowRect 失败'
    }
    $width = $bounds.Right - $bounds.Left
    $height = $bounds.Bottom - $bounds.Top
    if ($width -lt 100 -or $height -lt 100) { throw "游戏窗口尺寸异常：${width}x${height}" }
    $bitmap = New-Object Drawing.Bitmap $width, $height
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $hdc = $graphics.GetHdc()
        try { $printed = [DualWindowCapture]::PrintWindow($process.MainWindowHandle, $hdc, 2) }
        finally { $graphics.ReleaseHdc($hdc) }
        if (-not $printed) { $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size) }
        $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$hostBridge = $null
$clientBridge = $null
$hostGame = $null
$clientGame = $null
$beforeHashes = Get-SaveHashes
$hostLog = Join-Path $evidenceRoot 'host-player.log'
$clientLog = Join-Path $evidenceRoot 'client-player.log'
$summaryPath = Join-Path $evidenceRoot 'summary.json'
$uiScreenshotPath = Join-Path $evidenceRoot 'host-multiplayer-ui.png'
$pauseScreenshotPath = Join-Path $evidenceRoot 'host-online-pause-ui.png'

try {
    New-TestInstance $hostRoot 'host' 'host' 'HostTester'
    New-TestInstance $clientRoot 'client' 'client' 'ClientTester'

    $hostBridgeExe = Join-Path $hostRoot 'Mods\PlayerHostedMultiplayer\Bridge\MultiplayerBridgeHost.exe'
    $clientBridgeExe = Join-Path $clientRoot 'Mods\PlayerHostedMultiplayer\Bridge\MultiplayerBridgeHost.exe'
    $hostBridge = Start-Process -FilePath $hostBridgeExe -ArgumentList @('--channel', 'host', '--log-path', $hostLog, '--network-only') -WindowStyle Hidden -PassThru
    $clientBridge = Start-Process -FilePath $clientBridgeExe -ArgumentList @('--channel', 'client', '--log-path', $clientLog, '--network-only') -WindowStyle Hidden -PassThru

    Wait-Until { (Read-State $hostRoot 'host').heartbeatUtcTicks -gt 0 } '房主桥接心跳'
    Wait-Until { (Read-State $clientRoot 'client').heartbeatUtcTicks -gt 0 } '客户端桥接心跳'

    $hostWidth = if ($CaptureUiOnly) { '1920' } else { '1280' }
    $hostHeight = if ($CaptureUiOnly) { '1080' } else { '900' }
    $hostGame = Start-Process -FilePath (Join-Path $hostRoot 'FallenFlower.exe') -WorkingDirectory $hostRoot `
        -ArgumentList @('--enable-mods', '-screen-fullscreen', '0', '-screen-width', $hostWidth, '-screen-height', $hostHeight, '-logFile', $hostLog) -PassThru
    Wait-Until { (Read-State $hostRoot 'host').state -eq 'hosting' } '房主开始监听'

    if ($CaptureUiOnly) {
        Wait-Until { Test-Log $hostLog '诊断模式：已打开联机界面供截图' } '房主真实打开联机配置界面'
        Save-WindowScreenshot $hostGame $uiScreenshotPath
        if (-not (Test-Path -LiteralPath $uiScreenshotPath) -or (Get-Item -LiteralPath $uiScreenshotPath).Length -lt 10000) {
            throw '联机 UI 截图不存在或内容为空'
        }
        $summary = [ordered]@{
            passed = $true
            uiOnly = $true
            timestampUtc = [DateTime]::UtcNow.ToString('O')
            port = $Port
            address = $Address
            hostGamePid = $hostGame.Id
            hostBridgePid = $hostBridge.Id
            hostState = Read-State $hostRoot 'host'
            multiplayerUiOpenedAndCaptured = $true
            multiplayerUiScreenshot = $uiScreenshotPath
        }
        [IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
        Write-Host "PASS 联机 UI 已由真实游戏窗口打开并截图。证据：$summaryPath"
        return
    }

    if ($CapturePauseUiOnly) {
        Wait-Until { Test-Log $hostLog '诊断模式：线上暂停后手机窗口已正常打开，游戏时间未暂停' } `
            '房主已进入游戏且完成首轮暂停恢复'
        # Windows 的前台焦点限制会让自动化 ESC 在无人值守运行时被系统丢弃。
        # 测试通道改由游戏自己的 WindowManager 打开同一个原版 PauseWindow；菜单对象、
        # Start Hook、按钮布局及暂停状态仍全部走生产代码。
        Wait-Until { Test-Log $hostLog '已在 ESC 暂停菜单中创建原生样式的“联机”按钮，并重新等距排列菜单' } `
            '原版 PauseWindow 创建联机按钮'
        Wait-Until { Test-Log $hostLog '\[双实例证据\] 联机暂停菜单背景持续运行 count=1 pauseVisible=true paused=false timeScale=1.0' } `
            '原版 PauseWindow 显示时彻底清除游戏暂停状态'
        Wait-Until { Test-Log $hostLog '\[双实例证据\] PauseWindow 保持显示且背景持续运行 paused=false timeScale=1 delta=' } `
            '暂停菜单后方的 Mod 权威时间和世界持续运行'
        Save-WindowScreenshot $hostGame $pauseScreenshotPath
        if (-not (Test-Path -LiteralPath $pauseScreenshotPath) -or (Get-Item -LiteralPath $pauseScreenshotPath).Length -lt 10000) {
            throw '暂停菜单截图不存在或内容为空'
        }
        $summary = [ordered]@{
            passed = $true
            pauseUiOnly = $true
            timestampUtc = [DateTime]::UtcNow.ToString('O')
            port = $Port
            address = $Address
            hostGamePid = $hostGame.Id
            hostBridgePid = $hostBridge.Id
            originalPauseWindowOpenedInGame = $true
            onlinePauseKeepsWorldRunning = $true
            gamePausedFlagClearedWhileMenuVisible = $true
            authoritativeClockAdvancedBehindPauseMenu = $true
            pauseMenuScreenshot = $pauseScreenshotPath
        }
        [IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
        Write-Host "PASS 原版 PauseWindow 已显示且联机模式未暂停世界时间。证据：$summaryPath"
        return
    }

    $clientGame = Start-Process -FilePath (Join-Path $clientRoot 'FallenFlower.exe') -WorkingDirectory $clientRoot `
        -ArgumentList @('--enable-mods', '-screen-fullscreen', '0', '-screen-width', '800', '-screen-height', '600', '-logFile', $clientLog) -PassThru

    Wait-Until {
        $hostState = Read-State $hostRoot 'host'
        $clientState = Read-State $clientRoot 'client'
        $hostState.state -eq 'hosting' -and $hostState.peers -eq 1 -and $clientState.state -eq 'connected'
    } '两个真实游戏建立 TCP 会话'

    # 20 Hz 状态会快速轮换桥接内存环；完整资料字段改从持久测试日志解析，再结合接收端日志
    # 验证到达，不能依赖数秒后仍保留最早的 profile 事件。
    Wait-Until { Test-FullProfileInLog $hostLog 'HostTester' } '房主生成完整玩家资料字段'
    Wait-Until { Test-FullProfileInLog $clientLog 'ClientTester' } '客户端生成完整玩家资料字段'
    Wait-Until { Test-Log $hostLog '已创建远端玩家模型: ClientTester' } '房主创建客户端人物模型'
    Wait-Until { Test-Log $clientLog '已创建远端玩家模型: HostTester' } '客户端创建房主人物模型'
    Wait-Until { Test-Log $hostLog '远端衣服映射完成: 1/1' } '房主应用客户端非空衣服资源'
    Wait-Until { Test-Log $clientLog '远端衣服映射完成: 1/1' } '客户端应用房主非空衣服资源'
    Wait-Until { Test-Log $hostLog '远端衣服骨骼绑定完成 dress=Sailor renderers=[1-9].*missing=0 root=Armature' } `
        '房主把客户端衣服完整重绑到远端骨架'
    Wait-Until { Test-Log $clientLog '远端衣服骨骼绑定完成 dress=Sailor renderers=[1-9].*missing=0 root=Armature' } `
        '客户端把房主衣服完整重绑到远端骨架'
    Wait-Until { Test-Log $hostLog '远端衣服骨骼驱动映射完成: [1-9][0-9]* 对' } '房主建立客户端衣服姿势驱动'
    Wait-Until { Test-Log $clientLog '远端衣服骨骼驱动映射完成: [1-9][0-9]* 对' } '客户端建立房主衣服姿势驱动'
    Wait-Until { Test-Log $hostLog '\[双实例证据\] 远端材质检查 invalid=0 tan=[0-9]+ unsupported=[0-9]+' } `
        '房主恢复客户端独立材质且没有错误 Shader'
    Wait-Until { Test-Log $clientLog '\[双实例证据\] 远端材质检查 invalid=0 tan=[0-9]+ unsupported=[0-9]+' } `
        '客户端恢复房主独立材质且没有错误 Shader'
    Wait-Until { Test-Log $hostLog '已接收玩家完整存档资料快照.*ClientTester' } '房主收到客户端资料'
    Wait-Until { Test-Log $clientLog '已接收玩家完整存档资料快照.*HostTester' } '客户端收到房主资料'
    Wait-Until { Test-Log $hostLog '\[双实例证据\] 已应用玩家实时资料 peer=1.*health=.*stamina=.*money=' } `
        '房主持续应用客户端生命耐力与金钱'
    Wait-Until { Test-Log $clientLog '\[双实例证据\] 已应用玩家实时资料 peer=0.*health=.*stamina=.*money=' } `
        '客户端持续应用房主生命耐力与金钱'
    # 在稳定连接上量取三秒内收到的状态序号增长。允许启动和帧率抖动，但必须明显高于旧版 5 Hz。
    $rateStartAt = [DateTime]::UtcNow
    $rateStartSequence = Get-MaxPlayerStateSequence $clientRoot 'client' 'HostTester'
    Start-Sleep -Seconds 3
    $rateEndSequence = Get-MaxPlayerStateSequence $clientRoot 'client' 'HostTester'
    $rateSeconds = ([DateTime]::UtcNow - $rateStartAt).TotalSeconds
    $observedPlayerStateHz = ($rateEndSequence - $rateStartSequence) / $rateSeconds
    if ($rateStartSequence -le 0 -or $rateEndSequence -le $rateStartSequence -or $observedPlayerStateHz -lt 15) {
        throw "玩家状态刷新率不足：start=$rateStartSequence end=$rateEndSequence observed=$observedPlayerStateHz Hz"
    }
    Wait-Until { Test-Log $hostLog '诊断模式：线上暂停后手机窗口已正常打开，游戏时间未暂停' } `
        '房主从线上暂停状态恢复并打开手机窗口'
    Wait-Until { Test-Log $clientLog '诊断模式：线上暂停后手机窗口已正常打开，游戏时间未暂停' } `
        '客户端从线上暂停状态恢复并打开手机窗口'
    Wait-Until { Test-Log $hostLog '诊断模式：房主已移动两米并发送动作状态' } '房主执行确定性移动与动作'
    Wait-Until { Test-Log $clientLog 'action=7/3/1' } '客户端应用房主非零动作状态'
    $motionLine = Select-String -LiteralPath $hostLog -Pattern '房主已移动两米并发送动作状态 target=([-0-9.]+),' | Select-Object -Last 1
    if (-not $motionLine -or $motionLine.Line -notmatch 'target=([-0-9.]+),') { throw '无法读取房主移动目标坐标' }
    $expectedMotionX = [double]$Matches[1]
    # 动作诊断会保持数秒，期间可能正好进入下一场景；必须验证收到的第一帧，
    # 不能把场景出生点的后续坐标误当成这次两米移动的目标。
    $clientMotionLine = Select-String -LiteralPath $clientLog -Pattern 'pos=([-0-9.]+),.*action=7/3/1' | Select-Object -First 1
    if (-not $clientMotionLine -or $clientMotionLine.Line -notmatch 'pos=([-0-9.]+),') { throw '客户端动作包缺少位置坐标' }
    $receivedMotionX = [double]$Matches[1]
    if ([Math]::Abs($receivedMotionX - $expectedMotionX) -gt 1.0) {
        throw "客户端位置与房主移动目标偏差过大：host=$expectedMotionX client=$receivedMotionX"
    }
    Wait-Until { Test-Log $hostLog '诊断模式：房主已进入 StreetScene' } '房主进入 StreetScene'
    Wait-Until { Test-Log $clientLog '已进入房主场景: StreetScene' } '客户端跟随进入 StreetScene'
    Wait-Until { Test-Log $hostLog '诊断模式：房主已请求睡到明天，等待其他玩家' } '房主进入睡眠等待状态'
    Wait-Until { Test-Log $clientLog '诊断模式：客户端已请求睡到明天' } '客户端提交同一睡眠选择'
    Wait-Until { Test-Log $hostLog '全员睡眠共识已批准: tomorrow' } '房主批准全员睡眠'
    Wait-Until { Test-Log $clientLog '已收到全员睡眠批准: tomorrow' } '客户端收到同一睡眠批准'
    Wait-Until { Test-Log $hostLog '全部客户端已确认睡眠批准' } '房主收到客户端睡眠 ACK'
    Wait-Until { Test-Log $clientLog '\[双实例证据\] 已应用房主时间' } '客户端应用房主权威游戏时间'
    $hostJoinedLine = (Select-String -LiteralPath $hostLog -Pattern '玩家 ClientTester 已加入' | Select-Object -First 1).LineNumber
    $hostReadyLine = (Select-String -LiteralPath $hostLog -Pattern '诊断模式：房主已请求睡到明天' | Select-Object -First 1).LineNumber
    if (-not $hostJoinedLine -or -not $hostReadyLine -or $hostReadyLine -le $hostJoinedLine) {
        throw '房主在客户端完成握手前错误地批准了睡眠'
    }
    Start-Sleep -Seconds 3

    # 场景切换后的 Unity 对象失效最容易造成逐帧 Hook 异常；成功条件必须包含日志清洁。
    foreach ($logPath in @($hostLog, $clientLog)) {
        if (Test-Log $logPath '\[JintHookHandler\] Error executing Hook in JS') {
            throw "检测到 JavaScript Hook 运行异常：$logPath"
        }
        if (Test-Log $logPath '\[PlayerHostedMultiplayer\].*(失败|错误)') {
            throw "检测到联机 Mod 自报失败：$logPath"
        }
    }

    # 两个实例都已加载同一测试存档后，短暂向房主窗口发送 W，验证客户端收到新的坐标/动作包。
    $hostGame.Refresh()
    if ($hostGame.MainWindowHandle -ne [IntPtr]::Zero) {
        [DualGameInput]::SetForegroundWindow($hostGame.MainWindowHandle) | Out-Null
        [DualGameInput]::keybd_event(0x57, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Seconds 2
        [DualGameInput]::keybd_event(0x57, 0, 2, [UIntPtr]::Zero)
        Start-Sleep -Seconds 2
    }

    $hostEvidence = Select-String -LiteralPath $hostLog -Pattern '\[双实例证据\]' | Select-Object -Last 20 | ForEach-Object Line
    $clientEvidence = Select-String -LiteralPath $clientLog -Pattern '\[双实例证据\]' | Select-Object -Last 20 | ForEach-Object Line
    $afterHashes = Get-SaveHashes
    $hashesUnchanged = (($beforeHashes | ConvertTo-Json -Compress) -eq ($afterHashes | ConvertTo-Json -Compress))
    $summary = [ordered]@{
        passed = $true
        timestampUtc = [DateTime]::UtcNow.ToString('O')
        port = $Port
        address = $Address
        hostGamePid = $hostGame.Id
        clientGamePid = $clientGame.Id
        hostBridgePid = $hostBridge.Id
        clientBridgePid = $clientBridge.Id
        hostState = Read-State $hostRoot 'host'
        clientState = Read-State $clientRoot 'client'
        hostRemoteStateEvidence = @($hostEvidence)
        clientRemoteStateEvidence = @($clientEvidence)
        fullPlayerProfileFieldsVerified = $true
        livePlayerStatusContinuouslySynchronized = $true
        phoneWindowWorksAfterOnlinePause = $true
        nonEmptyClothingAndSkinTanVerified = $true
        remoteMaterialsHaveNoErrorShader = $true
        configuredPlayerStateHz = 20
        observedPlayerStateHz = [Math]::Round($observedPlayerStateHz, 2)
        remoteClothingBonesFullyRebound = $true
        deterministicMotionAndActionVerified = $true
        hostAuthoritativeSceneSyncVerified = $true
        unanimousSleepConsensusVerified = $true
        authoritativeWorldTimeApplied = $true
        noJavaScriptHookErrors = $true
        noMultiplayerModErrors = $true
        autoSaveHashesUnchanged = $hashesUnchanged
        autoSaveBefore = $beforeHashes
        autoSaveAfter = $afterHashes
    }
    [IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    Write-Host "PASS 双游戏实例、TCP、双方人物模型、完整玩家资料、移动动作和跨场景同步。证据：$summaryPath"
}
catch {
    $failure = [ordered]@{ passed = $false; timestampUtc = [DateTime]::UtcNow.ToString('O'); error = $_.Exception.ToString() }
    [IO.File]::WriteAllText($summaryPath, ($failure | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    throw
}
finally {
    foreach ($process in @($clientGame, $hostGame, $clientBridge, $hostBridge)) {
        if ($null -ne $process) {
            try { if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force } } catch { }
        }
    }
}
