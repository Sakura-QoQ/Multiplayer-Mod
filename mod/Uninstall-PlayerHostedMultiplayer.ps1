$ErrorActionPreference = 'Stop'
# 卸载时只移除本 Mod 的启动脚本和带标记的旧版代理，不接触游戏本体或存档。
$modDirectory = $PSScriptRoot
$modsDirectory = Split-Path -Parent $modDirectory
$gameDirectory = Split-Path -Parent $modsDirectory
$launcher = Join-Path $gameDirectory '启动联机 Mod.cmd'
$oldProxy = Join-Path $gameDirectory 'version.dll'

if (-not (Test-Path -LiteralPath (Join-Path $gameDirectory 'FallenFlower.exe'))) {
    throw "FallenFlower.exe was not found at $gameDirectory."
}
if (Test-Path -LiteralPath $launcher) {
    $launcherText = [IO.File]::ReadAllText($launcher)
    if ($launcherText.Contains('PlayerHostedMultiplayerLauncher')) {
        Remove-Item -LiteralPath $launcher -Force
    } else {
        throw "The launcher does not belong to PlayerHostedMultiplayer and was not removed: $launcher"
    }
}

if (Test-Path -LiteralPath $oldProxy) {
    $existingText = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($oldProxy))
    if ($existingText.Contains('PlayerHostedMultiplayerRuntimeVersion')) {
        Remove-Item -LiteralPath $oldProxy -Force
    }
}
Write-Host 'PlayerHostedMultiplayer launcher removed from the game folder.' -ForegroundColor Green
Write-Host 'The Mod folder can now be removed with the normal Mod manager.'
