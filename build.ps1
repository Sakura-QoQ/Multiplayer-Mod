param(
    [switch] $Install,
    [switch] $SkipPackage
)

$ErrorActionPreference = 'Stop'
# 本脚本只供开发机使用：编译自包含网络桥，并生成玩家可直接使用的 ZIP。
$projectRoot = $PSScriptRoot
$bridgeProject = Join-Path $projectRoot 'src\MultiplayerBridgeHost\MultiplayerBridgeHost.csproj'
$publishDir = Join-Path $projectRoot 'artifacts\bridge\win-x64'
$artifactsRoot = Join-Path $projectRoot 'artifacts'
$packageRoot = Join-Path $artifactsRoot 'package'
$packageMod = Join-Path $packageRoot 'PlayerHostedMultiplayer'
$packageZip = Join-Path $artifactsRoot 'PlayerHostedMultiplayer-v0.9.0-win-x64.zip'

function Import-VisualCppEnvironment {
    # 当前终端没有 link.exe 时，从现有 Visual Studio 安装中载入 x64 编译环境。
    if (Get-Command link.exe -ErrorAction SilentlyContinue) { return }

    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) {
        throw 'vswhere.exe was not found. Visual Studio with x64 C++ tools is required only on the developer machine.'
    }

    $installationPath = & $vswhere -latest -products * -property installationPath
    if ([string]::IsNullOrWhiteSpace($installationPath)) {
        throw 'Visual Studio was not found.'
    }

    $devShell = Join-Path $installationPath 'Common7\Tools\Launch-VsDevShell.ps1'
    if (-not (Test-Path -LiteralPath $devShell)) {
        throw "Launch-VsDevShell.ps1 was not found under $installationPath"
    }

    & $devShell -Arch amd64 -HostArch amd64 -SkipAutomaticLocation

    if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
        throw 'The x64 Visual C++ linker is still unavailable after loading VsDevCmd.bat.'
    }
}

function Remove-ProjectPath([string] $root, [string] $path, [switch] $Recurse) {
    # 所有构建清理都经过同一个边界检查，避免重复实现路径判断。
    $resolvedRoot = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
    $resolvedPath = [IO.Path]::GetFullPath($path)
    $comparisonPath = if ($Recurse) { $resolvedPath.TrimEnd('\') + '\' } else { $resolvedPath }
    if (-not $comparisonPath.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside the expected directory: $resolvedPath"
    }
    if (Test-Path -LiteralPath $resolvedPath) {
        Remove-Item -LiteralPath $resolvedPath -Force -Recurse:$Recurse
    }
}

function Copy-ModPayload([string] $destination) {
    # 只复制运行时必需文件；源码和调试中间文件不进入玩家包。
    $bridgeDestination = Join-Path $destination 'Bridge'
    New-Item -ItemType Directory -Force -Path $bridgeDestination | Out-Null
    Copy-Item -Path (Join-Path $projectRoot 'mod\*') -Destination $destination -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $publishDir 'MultiplayerBridgeHost.exe') -Destination (Join-Path $bridgeDestination 'MultiplayerBridgeHost.exe') -Force
    # 英文许可是正式文本，中文许可只供参考；两份都进入玩家包和本机安装目录。
    Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $destination 'LICENSE') -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE.zh-CN') -Destination (Join-Path $destination 'LICENSE.zh-CN') -Force

    # 从旧版本原地升级时删除不再使用的启动、安装和卸载脚本。
    $legacyScripts = @(
        'Start-Multiplayer.cmd',
        'Install-PlayerHostedMultiplayer.cmd',
        'Install-PlayerHostedMultiplayer.ps1',
        'Uninstall-PlayerHostedMultiplayer.cmd',
        'Uninstall-PlayerHostedMultiplayer.ps1',
        'runtime.log'
    )
    foreach ($legacyName in $legacyScripts) {
        Remove-ProjectPath $destination (Join-Path $destination $legacyName)
    }

    # 当前版本使用单文件自包含桥接程序，旧版注入 DLL 和代理目录不再参与运行。
    foreach ($legacyDirectoryName in @('Native', 'Runtime')) {
        Remove-ProjectPath $destination (Join-Path $destination $legacyDirectoryName) -Recurse
    }
}

Import-VisualCppEnvironment

dotnet publish $bridgeProject -c Release -r win-x64 --self-contained -o $publishDir
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
}

if (-not $SkipPackage) {
    # 每次重新创建 staging 目录，防止旧版本残留文件混进新包。
    New-Item -ItemType Directory -Force -Path $artifactsRoot | Out-Null
    if (Test-Path -LiteralPath $packageRoot) {
        Remove-ProjectPath $artifactsRoot $packageRoot -Recurse
    }
    New-Item -ItemType Directory -Force -Path $packageMod | Out-Null
    Copy-ModPayload $packageMod
    if (Test-Path -LiteralPath $packageZip) {
        Remove-Item -LiteralPath $packageZip -Force
    }
    Compress-Archive -LiteralPath $packageMod -DestinationPath $packageZip -CompressionLevel Optimal
    Write-Host "Packaged self-contained Mod: $packageZip"
}

if ($Install) {
    $gameRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)
    $modTarget = Join-Path $gameRoot 'Mods\PlayerHostedMultiplayer'
    Copy-ModPayload $modTarget

    # 仅清理本项目旧版本创建、且带有专用标记的游戏根目录启动脚本。
    $legacyLauncher = Join-Path $gameRoot '启动联机 Mod.cmd'
    if (Test-Path -LiteralPath $legacyLauncher) {
        $legacyLauncherContent = Get-Content -LiteralPath $legacyLauncher -Raw
        if ($legacyLauncherContent.Contains('PlayerHostedMultiplayerLauncher')) {
            Remove-Item -LiteralPath $legacyLauncher -Force
        }
    }
    Write-Host "Installed to $modTarget"
}
