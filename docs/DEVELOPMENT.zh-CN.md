# 开发指南

本仓库生成两个交付物：Windows 玩家 Mod 与 Linux Docker 房间服务器。玩家电脑只需要 Mod ZIP
和游戏启动器；生产联机流量经过房间服务器。

## 开发环境

- .NET 8 SDK
- 用于 NativeAOT 链接的 Visual Studio x64 C++ 构建工具
- 使用 `-Install` 和真实游戏集成测试时，需要本机安装 Fallen Flower
- 验证容器时需要 Docker Engine 与 Compose 插件

项目不使用 Node.js 或 TypeScript 编译器。游戏脚本在 UcModLauncher 的 Jint 环境中运行，
构建时只是按照清单合并 TypeScript 风格的源码文本。

桥接程序不会打开或修改 Windows 注册表。游戏到桥接的命令使用 Unity `Player.log` 中的专用标记行；
桥接到游戏的状态使用 Mod `Bridge` 目录内的轮换 JSON 文件。

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

在仓库根目录构建生产房间服务器：

```bash
cd server
cp .env.example .env
docker compose build
docker compose up -d
```

## 运行验证

构建两个 .NET 组件并运行存档自检：

```powershell
dotnet build ./src/MultiplayerBridgeHost/MultiplayerBridgeHost.csproj -c Release
dotnet build ./src/MultiplayerRoomServer/MultiplayerRoomServer.csproj -c Release
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-save-crypto
```

验证房间中继时，先在测试端口启动 `MultiplayerRoomServer`，再执行：

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe `
  --self-test-room-relay --address 127.0.0.1 --port 28783
```

该测试会启动两名桥接客户端，双方都发送 `room.enter`，验证自动创建/加入公开房间、权威映射和
双向转发。游戏级验证范围及仍未
覆盖的部分见 `VERIFICATION.zh-CN.md`。

`src/MultiplayerBridgeHost/PublicServerEndpoint.cs` 保存加密后的生产端点。更换地址时必须同时生成
新的 AES-GCM nonce、tag 和密文；不得把明文写入 `mod/config.json`、GameMod 源码、UI 文本或玩家文档。

## 发布包边界

玩家 ZIP 只包含生成后的 Mod 文件、六种语言包、中英文玩家说明、中英文许可、玩家资料字段映射，
以及一个自包含 Windows 桥接程序。源码、测试、SDK、构建工具和单独部署的 Ubuntu 房间服务器都不会
进入玩家包。

服务器部署只需要 `server/`、`src/MultiplayerRoomServer/` 和许可文件，不包含游戏、玩家存档、
Mod 脚本或 Windows 开发工具。
