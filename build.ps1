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
$packageZip = Join-Path $artifactsRoot 'PlayerHostedMultiplayer-v0.5.0-win-x64.zip'

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

function Copy-ModPayload([string] $destination) {
    # 只复制运行时必需文件；源码和调试中间文件不进入玩家包。
    $bridgeDestination = Join-Path $destination 'Bridge'
    New-Item -ItemType Directory -Force -Path $bridgeDestination | Out-Null
    Copy-Item -Path (Join-Path $projectRoot 'mod\*') -Destination $destination -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $publishDir 'MultiplayerBridgeHost.exe') -Destination (Join-Path $bridgeDestination 'MultiplayerBridgeHost.exe') -Force
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
        $resolvedArtifacts = [IO.Path]::GetFullPath($artifactsRoot)
        $resolvedPackage = [IO.Path]::GetFullPath($packageRoot)
        if (-not $resolvedPackage.StartsWith($resolvedArtifacts, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to clean package path outside artifacts: $resolvedPackage"
        }
        Remove-Item -LiteralPath $resolvedPackage -Recurse -Force
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
    Write-Host "Installed to $modTarget"
}
