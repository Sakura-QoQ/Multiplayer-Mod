# Fallen Flower 联机 Mod——独立服务器版

《Fallen Flower》联机 Mod，提供一键公开房间、本地直连、玩家模型同步和每名玩家独立的线上存档。

`PlayerHostedMultiplayer` 是为升级兼容保留的包名。公开房间使用单独部署的 Ubuntu 服务；联机主页仍保留本地“建立/加入”。

> **版本要求：**所有玩家必须使用相同游戏版本和 Mod 版本；Ubuntu 服务端从 `main` 自动部署，不使用玩家包版本号。
>
> **传输安全：**房间协议是带长度前缀的明文 TCP JSON，不是 TLS。端点隐藏和存档文件加密都不会加密网络流量；管理员令牌不要复用其他敏感密码。

[English](../README.md) · [文档索引](README.zh-CN.md) · [验证报告](VERIFICATION.zh-CN.md) · [许可中文参考](LICENSE.zh-CN)

## 发行文件

- 玩家 Mod 包：`artifacts/PlayerHostedMultiplayer-v0.14.2-win-x64.zip`

发布工作流会把玩家 ZIP 和校验文件上传到对应的公开 GitHub Release，也可以在 Actions 页面手动重新运行。服务器源码直接走自动部署流程，不生成服务器 ZIP。

## 安装与进入游戏

1. 使用游戏 Mod 启动器导入 `PlayerHostedMultiplayer-v0.14.2-win-x64.zip`。
2. 通过该启动器启动游戏。
3. 点击主菜单“新建游戏”上方的“联机”。
4. 输入玩家名，打开“公开服务器”，查看服务器管理的真实房间及实时人数/容量后选择房间。

主菜单右下角会在原版游戏版本号左侧显示 `Multiplayer v0.14.2`。该文本直接读取 `mod/info.json`，与玩家 ZIP 文件名使用同一个版本来源。

ZIP 已包含自包含 Windows x64 NativeAOT 桥接程序。玩家不需要安装 Node.js、TypeScript、.NET、Visual Studio，也不需要额外启动脚本。Mod 不写 Windows 注册表、不安装服务、不请求提权，也不调用软件安装器；运行偏好只放在游戏内存，会话身份通过 Mod 自己的轮换 JSON 状态文件和线上存档文件名保持。公开服务器只需要出站 TCP；玩家电脑不开放入站端口。

联机 Mod 的独立诊断日志位于 `Mods/PlayerHostedMultiplayer/Logs/PlayerHostedMultiplayer.log`。日志达到 4 MiB 后轮换并保留一份 `PlayerHostedMultiplayer.previous.log`；桥接程序崩溃时还会在同一目录生成 `PlayerHostedMultiplayer.crash.log`。

本地直连可使用“建立”或“加入”并填写地址和端口。跨公网连接玩家电脑房主时，房主可能仍需配置 Windows 防火墙与路由器端口映射。

## 当前功能

- `public-1` 是服务器常驻公开房间，所有玩家退出后仍会显示。全部可加入房间满员后才自动建立下一间，并只回收非常驻的多余空房间。公开房间容量只由服务器的 `FF_ROOM_MAX_PLAYERS` 决定。
- 玩家 Mod 配置中的 `localMaxPlayers` 只用于本机建立本地直连房间；公开服务器玩家不能决定或降低房间容量。
- Ubuntu 服务固定为逻辑权威 Peer `0`。公开玩家取得房间内最小的空闲正数 ID；玩家离开后编号立即复用，第一个玩家也没有特殊权限。
- 服务器负责成员、5 Hz 房间时段、场景裁决和全员睡眠批准；新房间或刚变空的房间从早晨开始，完整房间周期固定为现实 3,600 秒。绝对剧情日期始终属于各玩家存档，不会写入房间时钟。服务器转发玩家数据，但不运行 Unity 游戏逻辑，也不保存玩家存档。
- 客户端不产生独立心跳流量，现有 TCP 游戏/控制帧会刷新连接活动时间；连续 5 分钟没有收到完整数据帧时，服务器关闭失联连接，并通过正常退出使用的同一条路径释放成员位置。
- 已连接玩家的世界坐标连续 5 分钟没有产生至少 0.05 单位的有效位移、也没有切换场景时，同样判定为挂机，并通过同一清理路径释放位置和 ID。
- 玩家位置和动作快照以 20 Hz 发送；远端位置、动画层和衣服骨骼逐渲染帧更新。
- 衣服、晒黑肤色、捏脸、完整 `GameManager.GetSave()` 资料快照和小型实时状态包用于远端显示与玩家资料页；远端进度不会合并到其他玩家的本地存档。
- 线上暂停菜单保留游戏原版暂停与时间流速；其中“联机”页面只读显示房间身份、人数和名单。手机底部“通讯录”显示当前线上玩家。
- 菜单打开时服务器权威时段仍继续；新玩家加入已有房间时只采用当前房间时段，不会改变房间，也不会继承其他玩家的剧情日期。全部在线玩家选择相同睡眠方式后推进时间；跨过午夜时，每名当前玩家只在自己的剧情日期上增加一天。

公开端点以 AES-GCM 混淆常量保存在原生桥接程序内，不进入可编辑配置或 UI 文本。这能防止随手修改，但客户端含有解密材料，因此不属于真正的秘密管理。

## 默认存档

从 v0.14.10 开始，进入房间后在同一个调用栈内通过游戏原版 `LoadSaveWindow.Load("AutoSave")` 自动读取默认档，存档选择框不会被渲染，也不要求玩家选择。Mod 不调用 `StartGame`/`GameManager.LoadGame`，不再创建、读取、重定向、加密或晋升 `MPOnline/MPActive`；自动保存和床边保存沿用原版默认槽位。旧线上文件保留供人工恢复但当前版本不会访问；服务器不会接收或保存玩家存档。

## 构建与部署

开发机需要 .NET 8 SDK 和 Visual Studio x64 C++ 工具：

```powershell
./build.ps1 -Install
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-save-crypto
```

服务器管理员参阅 [服务器部署](../server/README.zh-CN.md)；开发者从 [开发指南](DEVELOPMENT.zh-CN.md) 和 [架构说明](ARCHITECTURE.zh-CN.md) 开始。

## 支持环境

- Windows x64 玩家电脑
- 使用游戏专用 Mod 启动器的 Fallen Flower
- 安装 Docker Engine 与 Compose 的 Ubuntu/Linux 服务器
- 能连接房间服务器配置端口的 TCP/IPv4 或 IPv6 网络

## 许可

本项目是专有、非公开源码软件。获得授权的二进制副本可用于个人用途；披露源码、再分发、修改或商业使用必须事先取得书面许可。英文 [LICENSE](LICENSE) 为正式许可文本。
