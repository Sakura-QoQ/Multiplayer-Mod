$ErrorActionPreference = 'Stop'
# 安装不注入游戏进程的启动脚本；网络桥和全部运行库都保留在 Mod 目录中。
$modDirectory = $PSScriptRoot
$modsDirectory = Split-Path -Parent $modDirectory
$gameDirectory = Split-Path -Parent $modsDirectory
$bridge = Join-Path $modDirectory 'Bridge\MultiplayerBridgeHost.exe'
$source = Join-Path $modDirectory 'Start-Multiplayer.cmd'
$destination = Join-Path $gameDirectory '启动联机 Mod.cmd'
$oldProxy = Join-Path $gameDirectory 'version.dll'

if (-not (Test-Path -LiteralPath (Join-Path $gameDirectory 'FallenFlower.exe'))) {
    throw "FallenFlower.exe was not found at $gameDirectory. Install this Mod under the game's Mods folder first."
}
if (-not (Test-Path -LiteralPath $bridge)) { throw 'Bridge\MultiplayerBridgeHost.exe is missing from the Mod package.' }
if (-not (Test-Path -LiteralPath $source)) { throw 'Start-Multiplayer.cmd is missing from the Mod package.' }

# 升级旧版时，只清理带本 Mod 标记的旧代理；其他来源的同名 DLL 绝不触碰。
if (Test-Path -LiteralPath $oldProxy) {
    $oldText = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($oldProxy))
    if ($oldText.Contains('PlayerHostedMultiplayerRuntimeVersion')) {
        Remove-Item -LiteralPath $oldProxy -Force
    }
}
Copy-Item -LiteralPath $source -Destination $destination -Force
Write-Host 'PlayerHostedMultiplayer installed without game DLL injection.' -ForegroundColor Green
Write-Host "Please launch with: $destination"
Write-Host 'Players do not need Visual Studio, .NET, Node.js, or any SDK.'
