# 开发指南

玩家电脑只需要发布 ZIP 和游戏 Mod 启动器。以下工具仅开发电脑需要。

## 开发环境

- .NET 8 SDK
- 用于 NativeAOT 链接的 Visual Studio x64 C++ 构建工具
- 使用 `-Install` 和真实游戏集成测试时，需要本机安装 Fallen Flower

项目不使用 Node.js 或 TypeScript 编译器。游戏脚本在 UcModLauncher 的 Jint 环境中运行，
构建时只是按照清单合并 TypeScript 风格的源码文本。

## 构建和安装

```powershell
./build.ps1 -Install
```

版本号从 `mod/info.json` 读取，输出文件为
`artifacts/PlayerHostedMultiplayer-v<版本>-win-x64.zip`。`-Install` 会把同一份内容复制到游戏的
`Mods/PlayerHostedMultiplayer`。依赖成功还原过以后，可以用
`./build.ps1 -Install -NoRestore` 离线重建。

只修改 `src/GameMod` 下的源码；`mod/main.ts` 和运行语言包均由构建生成。新增模块时必须写入
`src/GameMod/source-order.json`。如果存在清单遗漏/孤立模块、重复清单项、页面直接创建底层控件，
或者任意语言与英语的翻译键不一致，构建会直接失败。

## 运行验证

```powershell
dotnet run --project ./src/MultiplayerBridge.SmokeTest -c Release
```

冒烟测试用于校验桥接协议、网络传输、存档加密和核心状态处理。

## 发布包边界

玩家 ZIP 只包含生成后的 Mod 文件、六种语言包、中英文玩家说明、中英文许可、玩家资料字段映射，
以及一个自包含 Windows 桥接程序。源码、测试、SDK、构建工具和实验性 Ubuntu 房间服务器都不会
进入玩家包。
