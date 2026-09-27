# Fallen Flower 联机 Mod——独立服务器版

《Fallen Flower》联机 Mod，提供一键公开房间、本地直连、玩家模型同步和每名玩家独立的线上存档。

`PlayerHostedMultiplayer` 是为升级兼容保留的包名。公开房间使用单独部署的 Ubuntu 服务；联机主页仍保留本地“建立/加入”。

> **版本要求：**玩家 Mod 与 Ubuntu 服务必须同时使用 v0.13.1；所有玩家还必须使用相同游戏版本和 Mod 版本。
>
> **传输安全：**房间协议是带长度前缀的明文 TCP JSON，不是 TLS。端点隐藏和存档文件加密都不会加密网络流量；管理员令牌不要复用其他敏感密码。

[English](../README.md) · [文档索引](README.zh-CN.md) · [验证报告](VERIFICATION.zh-CN.md) · [许可中文参考](LICENSE.zh-CN)

## 发行文件

- 玩家 Mod 包：`artifacts/PlayerHostedMultiplayer-v0.13.1-win-x64.zip`
- Ubuntu 服务器源码包：`artifacts/FallenFlowerRoomServer-v0.13.1-source.zip`

发布工作流会把两份文件上传到对应的公开 GitHub Release，也可以在 Actions 页面手动重新运行。

## 安装与进入游戏

1. 使用游戏 Mod 启动器导入 `PlayerHostedMultiplayer-v0.13.1-win-x64.zip`。
2. 通过该启动器启动游戏。
3. 点击主菜单“新建游戏”上方的“联机”。
4. 输入玩家名，打开“公开服务器”，查看服务器管理的真实房间及实时人数/容量后选择房间。

ZIP 已包含自包含 Windows x64 NativeAOT 桥接程序。玩家不需要安装 Node.js、TypeScript、.NET、Visual Studio，也不需要额外启动脚本。Mod 不写 Windows 注册表、不安装服务、不请求提权，也不调用软件安装器；运行偏好只放在游戏内存，会话身份通过 Mod 自己的轮换 JSON 状态文件和线上存档文件名保持。公开服务器只需要出站 TCP；玩家电脑不开放入站端口。

本地直连可使用“建立”或“加入”并填写地址和端口。跨公网连接玩家电脑房主时，房主可能仍需配置 Windows 防火墙与路由器端口映射。

## 当前功能

- 服务器启动时只建立一个真实公开房间；全部现有房间满员后才自动建立下一间，并回收多余空房间。公开房间容量只由服务器的 `FF_ROOM_MAX_PLAYERS` 决定。
- 玩家 Mod 配置中的 `localMaxPlayers` 只用于本机建立本地直连房间；公开服务器玩家不能决定或降低房间容量。
- Ubuntu 服务固定为逻辑权威 Peer `0`。公开玩家取得房间内最小的空闲正数 ID；玩家离开后编号立即复用，第一个玩家也没有特殊权限。
- 服务器负责成员、5 Hz 统一时钟、场景裁决和全员睡眠批准；完整游戏日固定为现实 3,600 秒。它转发玩家数据，但不运行 Unity 游戏逻辑，也不保存玩家存档。
- 客户端不产生独立心跳流量，现有 TCP 游戏/控制帧会刷新连接活动时间；连续 5 分钟没有收到完整数据帧时，服务器关闭失联连接，并通过正常退出使用的同一条路径释放成员位置。
- 已连接玩家的世界坐标连续 5 分钟没有产生至少 0.05 单位的有效位移、也没有切换场景时，同样判定为挂机，并通过同一清理路径释放位置和 ID。
- 玩家位置和动作快照以 20 Hz 发送；远端位置、动画层和衣服骨骼逐渲染帧更新。
- 衣服、晒黑肤色、捏脸、完整 `GameManager.GetSave()` 资料快照和小型实时状态包用于远端显示与玩家资料页；远端进度不会合并到其他玩家的本地存档。
- 打开线上暂停菜单不会暂停世界；其中“联机”页面只读显示房间身份、统一时间、人数和名单。按住 `Tab` 可显示居中玩家名单。
- 菜单打开时服务器权威时间仍继续；全部在线玩家选择相同睡眠方式后推进时间。单人房间会立即批准，“睡到明天”由服务器直接推进到下一天，不再等待客户端回写时间。

公开端点以 AES-GCM 混淆常量保存在原生桥接程序内，不进入可编辑配置或 UI 文本。这能防止随手修改，但客户端含有解密材料，因此不属于真正的秘密管理。

## 线上存档隔离

每名玩家只持久保存一个 `MPOnline_<UUIDv7>.save`；服务器不会接收或保存该文件。

1. 进入时，桥接程序校验并解密 `MPOnline`，临时生成 `MPActive_<UUIDv7>.save`，因为游戏只能读取原生 `Encrypted` 格式。
2. 加载期间是强制只读事务；游戏端与桥接端写入锁都会拒绝自动保存。
3. `LoadGame` 完成后立即删除临时 `MPActive`。
4. 线上自动保存把原版 `SaveGame("AutoSave")` 重定向到可丢弃的 `MPActive`，保留原版退出/切换流程，同时不触碰线下 `AutoSave.save`。
5. 与床互动时会增加一个原版样式的“保存游戏”选项，玩家可主动提交并验证 `MPOnline`。
6. 暂停菜单的退出按钮保持游戏原版行为，退出时不保存，也不会拦截退出。

因此只有 `MPOnline` 是权威持久档；原版自动保存短暂生成的 `MPActive` 只会被丢弃，不会晋升覆盖正式档。线上流程既不读取也不写入单机 `AutoSave.save`，线上文件也不会显示在原版读取/保存页面。

内层是游戏原版 PBKDF2-SHA256/AES-256-CBC/HMAC-SHA256 `Encrypted` 格式；Mod 外层使用 PBKDF2-SHA256 与 AES-256-GCM 认证加密。这保护磁盘文件，不代表网络流量已加密。

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
