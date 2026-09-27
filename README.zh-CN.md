# PlayerHostedMultiplayer

《Fallen Flower》的玩家主机制联机 Mod。房主的 Windows 电脑同时承担房间服务器，不依赖中心服务器，也不要求玩家另行安装开发环境。

[English documentation](README.md) · [验证报告](VERIFICATION.zh-CN.md) · [许可协议中文参考](LICENSE.zh-CN)

## 功能

- 在主菜单增加与原版风格一致的“联机”入口，并在暂停菜单提供联机配置。
- 可直接在游戏内建立或加入房间；联机暂停菜单显示时，线上世界时间仍继续运行。
- 默认最多四名玩家，房主作为权威转发中心。
- 同步人物模型、位置、朝向、移动、落地状态、武器、动作和全部 Animator 层。
- 同步衣服、晒黑肤色、捏脸数据、完整存档资料和持续变化的玩家状态。
- 网络快照为 5 Hz，但远端位置、旋转、动画层和衣服骨骼会在每个渲染帧插值更新。
- 房主统一控制游戏时间、日期和时段；只有所有在线玩家在有效时间内选择相同睡眠方式，才会推进时间。
- 每名玩家固定使用一个 UUIDv7 线上存档，单机读取/保存页面不会显示线上文件。
- 线上模式退出前必须完成保存并验证，成功后才真正退出。

## 安装

1. 使用游戏专用 Mod 启动器导入 `PlayerHostedMultiplayer-v0.9.0-win-x64.zip`。
2. 通过该 Mod 启动器正常启动游戏。
3. 在主菜单“新建游戏”上方选择“联机”。

发布包已经包含 Windows x64 NativeAOT 网络桥和全部运行依赖。玩家不需要安装 Node.js、TypeScript、.NET、Visual Studio，也不需要运行额外启动脚本。

## 建立和加入房间

- **建立房间：**填写玩家名、端口和人数上限，选择“建立并进入”。Mod 会继续当前玩家固定 UUIDv7 对应的线上存档；磁盘上确实没有线上档时才从零创建。
- **加入房间：**填写房主地址和端口后选择“加入”。每名玩家保存自己的线上进度，不会互相覆盖存档。
- **局域网：**填写房主电脑的局域网 IPv4，例如 `192.168.1.20`。
- **互联网：**房主需要在 Windows 防火墙允许所选 TCP 端口，通常还需要路由器端口映射，或者使用可信的虚拟局域网工具。

所有玩家应使用相同的游戏版本和 Mod 版本。默认 TCP 端口为 `27777`。

## 项目结构

```text
PlayerHostedMultiplayer
├─ mod
│  ├─ main.ts                         游戏内 UI、Hook、同步与存档生命周期
│  ├─ config.json                     默认配置
│  ├─ README.txt                      默认英文玩家说明
│  ├─ README.zh-CN.txt                简体中文玩家说明
│  └─ i18n/<语言>/strings.json         游戏内语言包
├─ src
│  ├─ MultiplayerBridge               带帧边界的 TCP 网络核心
│  ├─ MultiplayerBridgeHost           NativeAOT 桥接、IPC 与存档保护
│  └─ MultiplayerBridge.SmokeTest      网络冒烟测试
├─ tests
│  ├─ dual-instance                   两个真实游戏进程的集成测试
│  └─ online-save                     线上存档生命周期集成测试
└─ build.ps1                          编译、打包和可选本机安装
```

`main.ts` 在 Mod 启动器的 Jint 环境中运行，通过有界命令和原子状态快照与随包桥接程序通信。TCP 消息使用四字节大端长度前缀加 UTF-8 JSON，并限制单包尺寸和队列容量。

## 同步方式

- 玩家状态和房主权威时间以 5 Hz 发送，控制网络流量。
- 画面仍逐帧更新：远端位置、旋转、动画层和衣服骨骼会向最新网络快照平滑插值。
- 完整 `GetSave()` 资料过大时会自动分片，接收端按修订号重组并为每名远端玩家保存。
- 生命、耐力、金钱、时间和场景等高频字段使用更小的实时资料包。
- 远端角色是纯显示克隆，激活前会移除输入、相机、碰撞和游戏逻辑脚本。

游戏存档包含照片记录和索引，但不包含外部 PNG 图片字节；这些外部图片文件目前不会传输。

## 线上存档隔离

- 正式文件：`MPOnline_<玩家 UUIDv7>.save`。
- 恢复工作副本：`MPActive_<玩家 UUIDv7>.save`。
- 两种文件都会从原版单机读取/保存页面中过滤。
- 内层完全兼容游戏原版 `Encrypted` 格式：PBKDF2-SHA256、AES-256-CBC 和 HMAC-SHA256。
- Mod 外层使用 PBKDF2-SHA256 和 AES-256-GCM 认证加密。
- 保存采用原子写入；工作副本会保留用于恢复，原版 `AutoSave*.save` 不会被覆盖。

## 构建与验证

开发机需要 .NET 8 SDK 和 Visual Studio x64 C++ 工具，用于 NativeAOT 链接：

```powershell
./build.ps1 -Install
dotnet run --project ./src/MultiplayerBridge.SmokeTest -c Release
./tests/online-save/Run-OnlineSaveLifecycleTest.ps1
./tests/dual-instance/Run-DualInstanceTest.ps1 -Address <局域网 IPv4>
```

集成测试会创建临时轻量游戏实例，不会进入玩家发布包。已验证范围和证据路径见 [VERIFICATION.zh-CN.md](VERIFICATION.zh-CN.md)。

## 支持环境

- Windows x64
- 安装游戏专用 Mod 启动器的 Fallen Flower
- 所有参与者使用相同游戏版本和 Mod 版本

## 许可

本项目是专有、非公开源码软件。获得授权的二进制副本可用于个人用途；披露源码、再分发、修改或商业使用必须事先取得书面许可。英文 [LICENSE](LICENSE) 为正式许可文本。
