param(
    [switch] $Install,
    [switch] $SkipPackage,
    [switch] $NoRestore
)

$ErrorActionPreference = 'Stop'
# 本脚本只供开发机使用：编译自包含网络桥，并生成玩家可直接使用的 ZIP。
$projectRoot = $PSScriptRoot
$bridgeProject = Join-Path $projectRoot 'src\MultiplayerBridgeHost\MultiplayerBridgeHost.csproj'
$gameModSourceRoot = Join-Path $projectRoot 'src\GameMod'
$gameModManifest = Join-Path $gameModSourceRoot 'source-order.json'
$gameModOutput = Join-Path $projectRoot 'mod\main.ts'
$modInfoPath = Join-Path $projectRoot 'mod\info.json'
$publishDir = Join-Path $projectRoot 'artifacts\bridge\win-x64'
$artifactsRoot = Join-Path $projectRoot 'artifacts'
$packageRoot = Join-Path $artifactsRoot 'package'
$packageMod = Join-Path $packageRoot 'PlayerHostedMultiplayer'
$modVersion = ([string](Get-Content -LiteralPath $modInfoPath -Raw -Encoding UTF8 | ConvertFrom-Json).version).TrimStart('v')
if ($modVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid Mod version in info.json: $modVersion" }
$packageZip = Join-Path $artifactsRoot "PlayerHostedMultiplayer-v$modVersion-win-x64.zip"

function Assert-RuntimeSafety {
    # 运行时代码禁止调用注册表后端、提权或软件安装工具。桥接程序只能以当前用户权限
    # 作为 Mod 自带的便携组件启动；这项检查用于防止后续修改意外破坏该约束。
    $runtimeFiles = @(
        Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src\GameMod') -Filter '*.ts' -File -Recurse
        Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src\MultiplayerBridge') -Filter '*.cs' -File -Recurse
        Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src\MultiplayerBridgeHost') -Filter '*.cs' -File -Recurse
    )
    $forbiddenPatterns = @(
        'UnityEngine\.PlayerPrefs',
        'Microsoft\.Win32\.Registry',
        '\bRegistryKey\b',
        '\breg\.exe\b',
        '\bmsiexec(?:\.exe)?\b',
        '\bwinget(?:\.exe)?\b',
        '\bchoco(?:\.exe)?\b',
        'Verb\s*=\s*["'']runas["'']'
    )
    foreach ($pattern in $forbiddenPatterns) {
        $match = $runtimeFiles | Select-String -Pattern $pattern -CaseSensitive:$false | Select-Object -First 1
        if ($match) {
            throw "Forbidden registry, elevation, or installer API in runtime code: $($match.Path):$($match.LineNumber)"
        }
    }
}

function Build-GameModSource {
    # UcModLauncher 当前只加载单个 main.ts，不负责解析 TypeScript import。
    # 开发源码按职责拆分，构建时依照显式清单合并，玩家端不需要 Node.js 或 TypeScript。
    if (-not (Test-Path -LiteralPath $gameModManifest)) {
        throw "Game Mod source manifest was not found: $gameModManifest"
    }

    $sourceOrder = Get-Content -LiteralPath $gameModManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $sourceOrder -or $sourceOrder.Count -eq 0) {
        throw 'Game Mod source manifest is empty.'
    }
    if (($sourceOrder | Select-Object -Unique).Count -ne $sourceOrder.Count) {
        throw 'Game Mod source manifest contains duplicate modules.'
    }

    # 清单必须覆盖每个源码模块，防止新增文件忘记进入单文件发布入口。
    $listedSources = @($sourceOrder | ForEach-Object { ([string]$_).Replace('\', '/') } | Sort-Object)
    $discoveredSources = @(Get-ChildItem -LiteralPath $gameModSourceRoot -Filter '*.ts' -File -Recurse |
        ForEach-Object { $_.FullName.Substring($gameModSourceRoot.Length + 1).Replace('\', '/') } | Sort-Object)
    $sourceDifference = @(Compare-Object $listedSources $discoveredSources)
    if ($sourceDifference.Count -gt 0) {
        throw "source-order.json does not exactly match src/GameMod modules: $($sourceDifference | Out-String)"
    }

    # 英语是回退语言；其他语言必须拥有完全相同的键，避免切换后显示键名或旧文本。
    $i18nRoot = Join-Path $gameModSourceRoot 'ui\i18n'
    $englishPath = Join-Path $i18nRoot 'en\strings.json'
    $englishKeys = @((Get-Content -LiteralPath $englishPath -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties.Name | Sort-Object)
    foreach ($languageDirectory in Get-ChildItem -LiteralPath $i18nRoot -Directory) {
        $languagePath = Join-Path $languageDirectory.FullName 'strings.json'
        $languageKeys = @((Get-Content -LiteralPath $languagePath -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties.Name | Sort-Object)
        $keyDifference = @(Compare-Object $englishKeys $languageKeys)
        if ($keyDifference.Count -gt 0) {
            throw "Translation keys differ for $($languageDirectory.Name): $($keyDifference | Out-String)"
        }
    }

    # 页面只能组合 ui/components 提供的构造函数，不能重新散落底层 Unity 控件创建代码。
    $pageFiles = Get-ChildItem -LiteralPath (Join-Path $gameModSourceRoot 'ui\pages') -Filter '*.ts'
    $forbiddenPageCode = $pageFiles | Select-String -Pattern `
        'new\s+UnityEngine\.GameObject|\.AddComponent\(|UnityEngine\.Object\.Instantiate\(|\.GetComponent\('
    if ($forbiddenPageCode) {
        throw "UI pages must compose ui/components instead of constructing Unity controls directly: $($forbiddenPageCode[0].Path):$($forbiddenPageCode[0].LineNumber)"
    }

    $builder = [Text.StringBuilder]::new()
    [void]$builder.AppendLine('// 此文件由 build.ps1 自动生成，请修改 src/GameMod 下的模块源码。')
    [void]$builder.AppendLine('// UcModLauncher 需要单文件入口，因此发布包中保留合并后的 main.ts。')
    foreach ($relativePath in $sourceOrder) {
        $sourcePath = Join-Path $gameModSourceRoot ([string]$relativePath)
        if (-not (Test-Path -LiteralPath $sourcePath)) {
            throw "Game Mod source module was not found: $sourcePath"
        }
        [void]$builder.AppendLine()
        [void]$builder.AppendLine("// ===== 模块: $relativePath =====")
        [void]$builder.Append((Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8).TrimEnd())
        [void]$builder.AppendLine()
    }
    # 生成文件固定使用 LF，避免开发机 Git 配置造成整文件换行噪音。
    $mergedSource = $builder.ToString().Replace("`r`n", "`n")
    [IO.File]::WriteAllText($gameModOutput, $mergedSource, [Text.UTF8Encoding]::new($false))

    # 语言包属于 UI 源码；发布目录中的 mod/i18n 只是运行时副本。
    $sourceI18n = Join-Path $gameModSourceRoot 'ui\i18n'
    $runtimeI18n = Join-Path $projectRoot 'mod\i18n'
    foreach ($languageDirectory in Get-ChildItem -LiteralPath $sourceI18n -Directory) {
        $runtimeLanguageDirectory = Join-Path $runtimeI18n $languageDirectory.Name
        New-Item -ItemType Directory -Force -Path $runtimeLanguageDirectory | Out-Null
        Copy-Item -LiteralPath (Join-Path $languageDirectory.FullName 'strings.json') `
            -Destination (Join-Path $runtimeLanguageDirectory 'strings.json') -Force
    }
}

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
    # Bridge 目录会产生 state*.json 等运行时文件，不能把开发机状态复制进发布包。
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'mod') | Where-Object Name -ne 'Bridge' | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
    }
    Copy-Item -LiteralPath (Join-Path $publishDir 'MultiplayerBridgeHost.exe') -Destination (Join-Path $bridgeDestination 'MultiplayerBridgeHost.exe') -Force
    # 英文许可是正式文本，中文许可只供参考；两份都进入玩家包和本机安装目录。
    Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $destination 'LICENSE') -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE.zh-CN') -Destination (Join-Path $destination 'LICENSE.zh-CN') -Force
    # 玩家资料字段名以游戏原始标识符为准；中英文映射文档随发布包分发。
    Copy-Item -LiteralPath (Join-Path $projectRoot 'PLAYER_PROFILE_FIELDS.md') -Destination (Join-Path $destination 'PLAYER_PROFILE_FIELDS.md') -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'PLAYER_PROFILE_FIELDS.zh-CN.md') -Destination (Join-Path $destination 'PLAYER_PROFILE_FIELDS.zh-CN.md') -Force

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

Assert-RuntimeSafety
Build-GameModSource
Import-VisualCppEnvironment

$publishArguments = @('publish', $bridgeProject, '-c', 'Release', '-r', 'win-x64', '--self-contained', '-o', $publishDir)
if ($NoRestore) { $publishArguments += '--no-restore' }
& dotnet @publishArguments
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
