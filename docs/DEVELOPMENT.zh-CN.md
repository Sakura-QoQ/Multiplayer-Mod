# 开发指南

本仓库生成自包含 Windows 玩家 Mod 和单独部署的 Linux 房间服务器。玩家电脑只需要生成的 ZIP 与游戏 Mod 启动器。

## 开发环境

| 任务 | 所需软件 |
| --- | --- |
| 构建 Windows 桥接程序 | .NET 8 SDK、Visual Studio x64 C++ NativeAOT 工具 |
| 安装到开发用游戏 | 按仓库父目录布局安装的本地 Fallen Flower |
| 构建房间服务器 | Docker Engine 与 Compose，或 .NET 8 SDK |
| 使用玩家包 | 不需要开发软件，只需游戏和 Mod 启动器 |

项目不使用 Node.js 或 `tsc`。UcModLauncher 通过 Jint 执行 TypeScript 风格源码，`tools/Build-Mod.ps1` 只按顺序合并文本。

游戏脚本和桥接程序都不使用 Windows 注册表，也不调用 Unity 会落入注册表的偏好接口。命令通过 Unity `Player.log` 的专用标记行传递；响应、事件与当前会话身份使用安装目录 `Bridge` 下的轮换 JSON 状态文件。运行时不提权、不安装服务、不调用包管理器，也不下载依赖。

桥接程序会把普通 `[PlayerHostedMultiplayer]` 记录筛选到安装目录内的 `Logs/PlayerHostedMultiplayer.log`。文件写入在 Unity 游戏线程之外完成，高频 IPC 标记不会进入该日志；当前日志达到 4 MiB 后轮换并保留一份旧文件。

## 构建玩家 Mod

```powershell
./tools/Build-Mod.ps1 -Install
```

脚本从 `mod/info.json` 读取版本，生成 `mod/main.ts`，复制六种运行语言包，发布自包含 NativeAOT 桥，创建 `artifacts/PlayerHostedMultiplayer-v<版本>-win-x64.zip`，并可把同一负载安装到 `Mods/PlayerHostedMultiplayer`。

依赖至少成功还原一次后，可离线构建：

```powershell
./tools/Build-Mod.ps1 -Install -NoRestore
```

只编辑 `src/GameMod/`，不要直接修改生成的 `mod/main.ts` 或 `mod/i18n`。新增模块必须按依赖顺序加入 `src/GameMod/source-order.json`。构建会拒绝遗漏/重复模块、页面直接创建底层 Unity 控件、语言包键不一致，以及运行时代码中的注册表 API、提权请求和安装器命令。

## 验证功能

构建并运行当前运行日志自检：

```powershell
./tools/Build-Mod.ps1 -SkipPackage -NoRestore
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-runtime-log
```

测试独立房间适配时，先在测试端口运行房间服务器，再执行：

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe `
  --self-test-room-relay --address 127.0.0.1 --port 28783
```

测试先验证服务器绝不发送详细 `worldTime`，以及单人“睡到明天”，再创建第二个普通客户端，验证服务器协调 Peer `0`、双向转发和全员睡眠批准。游戏级证据和限制见 [验证报告](VERIFICATION.zh-CN.md)。

修改存档代码时必须确认：进入房间通过 Unity 消息直接调用原版 `LoadSaveWindow.Load("AutoSave")`，不点击 `LoadGame` 按钮，不调用 `StartGame`/`GameManager.LoadGame`；床边保存沿用 `GameManager.SaveName`，且不能重新引入桥接存档命令或磁盘重定向。构建脚本会拒绝这些危险调用。

## 构建服务器

```bash
cd server
cp .env.example .env
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100 room-server
```

Docker 构建上下文是仓库根目录，因为镜像需要复制 `src/MultiplayerRoomServer/` 与许可文件。更新、防火墙和排错见 [服务器文档](../server/README.zh-CN.md)。

`src/MultiplayerBridgeHost/PublicServerEndpoint.cs` 保存加密后的生产端点。更换地址必须同时生成新的 AES-GCM nonce、tag 与密文；不得把明文写进 `mod/config.json`、GameMod 源码、UI 文本或玩家文档。端点混淆不等于 TLS。

## 发布内容

玩家 ZIP 包含生成后的 Mod 文件、六种语言包、中英文玩家说明与许可、中英文资料字段映射，以及一个自包含 Windows 可执行程序；不包含源码、测试、SDK、构建工具或 Linux 服务器。

服务器部署需要 `server/`、`src/MultiplayerRoomServer/`、`docs/LICENSE` 和 `docs/LICENSE.zh-CN`，不需要游戏、玩家存档、Mod 脚本或 Windows 工具链。
