param(
    [int] $Port = 28840,
    [int] $TimeoutSeconds = 180,
    [switch] $KeepTestSavesOnFailure
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$gameRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '..\..'))
$installedMod = Join-Path $gameRoot 'Mods\PlayerHostedMultiplayer'
$runRoot = Join-Path $projectRoot ('artifacts\online-save\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$instanceRoot = Join-Path $runRoot 'game'
$evidenceRoot = Join-Path $runRoot 'evidence'
$saveRoot = Join-Path $env:USERPROFILE 'AppData\LocalLow\DefaultCompany\FallenFlower\Saves'
$channel = 'saveflow'
$timestampHex = '{0:x12}' -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$randomHex = [Guid]::NewGuid().ToString('N')
$uuid = $timestampHex.Substring(0,8) + '-' + $timestampHex.Substring(8,4) + '-7' +
    $randomHex.Substring(0,3) + '-a' + $randomHex.Substring(3,3) + '-' + $randomHex.Substring(6,12)
$onlineName = 'MPOnline_' + $uuid
$activeName = 'MPActive_' + $uuid
$onlinePath = Join-Path $saveRoot ($onlineName + '.save')
$activePath = Join-Path $saveRoot ($activeName + '.save')
$summaryPath = Join-Path $evidenceRoot 'summary.json'
$gameLog = Join-Path $evidenceRoot 'player.log'

New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null

function Wait-Until([scriptblock] $condition, [string] $description, [int] $seconds = $TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
    do {
        try { if (& $condition) { return } } catch { }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "等待超时：$description"
}

function Get-AutoSaveHashes {
    $result = @{}
    if (Test-Path -LiteralPath $saveRoot) {
        Get-ChildItem -LiteralPath $saveRoot -Filter 'AutoSave*.save' -File | ForEach-Object {
            $result[$_.Name] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    }
    return $result
}

function Set-TestConfig([string] $phase) {
    $config = [ordered]@{
        mode = 'host'; address = '127.0.0.1'; port = $Port; maxPlayers = 2; playerName = 'SaveTester'
        smokeTestAutoLoad = $false; smokeTestUiOpen = $false; smokeTestMotion = $false
        smokeTestSceneSync = $false; smokeTestSleepConsensus = $false; smokeTestAppearance = $false
        smokeTestPhone = $false; smokeTestPauseMenu = $false
        smokeTestOnlineLifecycle = $true; smokeTestOnlineSaveName = $onlineName
        smokeTestLifecyclePhase = $phase; bridgeChannel = $channel
    }
    [IO.File]::WriteAllText((Join-Path $instanceRoot 'Mods\PlayerHostedMultiplayer\config.json'),
        ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
}

function Start-TestBridge {
    $exe = Join-Path $instanceRoot 'Mods\PlayerHostedMultiplayer\Bridge\MultiplayerBridgeHost.exe'
    return Start-Process -FilePath $exe -ArgumentList @('--channel', $channel, '--log-path', $gameLog) `
        -WindowStyle Hidden -PassThru
}

function Start-TestGame {
    return Start-Process -FilePath (Join-Path $instanceRoot 'FallenFlower.exe') -WorkingDirectory $instanceRoot `
        -ArgumentList @('--enable-mods','-screen-fullscreen','0','-screen-width','1280','-screen-height','900','-logFile',$gameLog) `
        -PassThru
}

function Read-LifecyclePosition([string] $phase) {
    $line = Select-String -LiteralPath $gameLog -Pattern ("\[线上存档生命周期\] phase=" + $phase +
        " save=" + [regex]::Escape($onlineName) + " position=([-0-9.]+),([-0-9.]+),([-0-9.]+)") | Select-Object -Last 1
    if (-not $line -or $line.Line -notmatch 'position=([-0-9.]+),([-0-9.]+),([-0-9.]+)') {
        throw "无法读取 $phase 阶段的位置证据"
    }
    return @([double]$Matches[1], [double]$Matches[2], [double]$Matches[3])
}

$bridge = $null
$game = $null
$beforeAutoSave = Get-AutoSaveHashes
$testPassed = $false
try {
    if ((Test-Path -LiteralPath $onlinePath) -or (Test-Path -LiteralPath $activePath)) {
        throw "随机测试 UUID 意外冲突：$uuid"
    }
    New-Item -ItemType Directory -Force -Path $instanceRoot | Out-Null
    foreach ($name in @('FallenFlower.exe','GameAssembly.dll','UnityPlayer.dll','UnityCrashHandler64.exe','baselib.dll')) {
        New-Item -ItemType HardLink -Path (Join-Path $instanceRoot $name) -Target (Join-Path $gameRoot $name) | Out-Null
    }
    New-Item -ItemType Junction -Path (Join-Path $instanceRoot 'FallenFlower_Data') `
        -Target (Join-Path $gameRoot 'FallenFlower_Data') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $instanceRoot 'Mods') | Out-Null
    Copy-Item -LiteralPath (Join-Path $gameRoot 'Mods\Core') -Destination (Join-Path $instanceRoot 'Mods\Core') -Recurse -Force
    Copy-Item -LiteralPath $installedMod -Destination (Join-Path $instanceRoot 'Mods\PlayerHostedMultiplayer') -Recurse -Force
    $plan = [ordered]@{ Version = 1; Mods = @(
        [ordered]@{ Id='Core'; DirectoryName='Core'; Enabled=$true; LoadOrder=0 },
        [ordered]@{ Id='PlayerHostedMultiplayer'; DirectoryName='PlayerHostedMultiplayer'; Enabled=$true; LoadOrder=1 }) }
    [IO.File]::WriteAllText((Join-Path $instanceRoot 'Mods\modloadplan.json'),
        ($plan | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))

    Set-TestConfig 'create'
    $bridge = Start-TestBridge
    $game = Start-TestGame
    Wait-Until { (Test-Path -LiteralPath $gameLog) -and
        (Select-String -LiteralPath $gameLog -Pattern '\[线上存档生命周期\] phase=create' -Quiet) } '首次线上档保存并退出'
    Wait-Until { $game.Refresh(); $game.HasExited } '首次游戏进程退出' 30
    Wait-Until { $bridge.Refresh(); $bridge.HasExited } '首次桥接提交存档后退出' 20
    if (-not (Test-Path -LiteralPath $onlinePath) -or (Get-Item -LiteralPath $onlinePath).Length -le 4) {
        throw '首次退出后 MPOnline 正式档不存在或为空'
    }
    if (-not (Test-Path -LiteralPath $activePath) -or (Get-Item -LiteralPath $activePath).Length -le 0) {
        throw '首次退出后 MPActive 恢复副本被删除或为空'
    }
    $magic = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($onlinePath), 0, 4)
    if ($magic -ne 'MPB2') { throw "线上正式档缺少 Mod 外层认证加密头：$magic" }
    $createPosition = Read-LifecyclePosition 'create'
    Copy-Item -LiteralPath $onlinePath -Destination (Join-Path $evidenceRoot 'phase-create-online.save') -Force
    Copy-Item -LiteralPath $activePath -Destination (Join-Path $evidenceRoot 'phase-create-active.save') -Force

    Set-TestConfig 'resume'
    $bridge = Start-TestBridge
    $game = Start-TestGame
    Wait-Until { (Select-String -LiteralPath $gameLog -Pattern '\[线上存档生命周期\] phase=resume' -Quiet) } `
        '重新进入同一 UUID 线上档并保存退出'
    Wait-Until { $game.Refresh(); $game.HasExited } '第二次游戏进程退出' 30
    Wait-Until { $bridge.Refresh(); $bridge.HasExited } '第二次桥接提交存档后退出' 20
    $resumePosition = Read-LifecyclePosition 'resume'
    $positionDelta = [Math]::Sqrt([Math]::Pow($resumePosition[0]-$createPosition[0],2) +
        [Math]::Pow($resumePosition[1]-$createPosition[1],2) + [Math]::Pow($resumePosition[2]-$createPosition[2],2))
    # CharacterController 重新启用后会把落在床沿/家具碰撞体内的保存点推出到最近合法点。
    # RoomScene 的测试位移实测最大修正约 0.35 米，因此 0.5 米以内表示存档坐标已恢复，
    # 而不是仍停留在相距 3.25 米的默认出生点。
    if ($positionDelta -gt 0.5) { throw "续档位置未恢复：delta=$positionDelta" }
    $afterAutoSave = Get-AutoSaveHashes
    if (($beforeAutoSave | ConvertTo-Json -Compress) -ne ($afterAutoSave | ConvertTo-Json -Compress)) {
        throw '线上生命周期测试改动了单机 AutoSave'
    }
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
        throw '游戏与桥接退出后监听端口仍未释放'
    }
    $summary = [ordered]@{
        passed=$true; timestampUtc=[DateTime]::UtcNow.ToString('O'); uuidV7=$uuid; onlineSaveName=$onlineName
        createPosition=$createPosition; resumePosition=$resumePosition; positionDelta=$positionDelta
        encryptedOnlineLength=(Get-Item -LiteralPath $onlinePath).Length
        activeRecoveryLength=(Get-Item -LiteralPath $activePath).Length
        onlineMagic=$magic; autoSaveHashesUnchanged=$true; bridgeExitedTwice=$true; portReleased=$true
    }
    [IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    $testPassed = $true
    Write-Host "PASS 真实线上存档退出、双层加密、桥接清理和同 UUID 续档。证据：$summaryPath"
}
catch {
    $failure = [ordered]@{ passed=$false; timestampUtc=[DateTime]::UtcNow.ToString('O'); uuidV7=$uuid; error=$_.Exception.ToString() }
    [IO.File]::WriteAllText($summaryPath, ($failure | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    throw
}
finally {
    if ($game -and -not $game.HasExited) { Stop-Process -Id $game.Id -Force }
    if ($bridge -and -not $bridge.HasExited) { Stop-Process -Id $bridge.Id -Force }
    # 只删除本次随机 UUID 的两个测试文件；路径必须严格位于游戏 Saves 目录。
    $saveBoundary = [IO.Path]::GetFullPath($saveRoot).TrimEnd('\') + '\'
    foreach ($path in @($onlinePath,$activePath)) {
        $resolved = [IO.Path]::GetFullPath($path)
        if (-not $resolved.StartsWith($saveBoundary, [StringComparison]::OrdinalIgnoreCase)) {
            throw "拒绝清理 Saves 目录之外的路径：$resolved"
        }
        if (($testPassed -or -not $KeepTestSavesOnFailure) -and (Test-Path -LiteralPath $resolved)) {
            Remove-Item -LiteralPath $resolved -Force
        }
    }
}
