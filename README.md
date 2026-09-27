# PlayerHostedMultiplayer

《Fallen Flower》的玩家主机联机 Mod。房主电脑同时承担游戏服务器角色，不使用中心服务器。

## 当前结构

```text
PlayerHostedMultiplayer
├─ mod
│  ├─ main.ts                         游戏内 UI、协议和存档读取
│  ├─ config.json                     默认配置
│  ├─ i18n                            跟随游戏语言的界面语言包
│  │  ├─ en / ja / ko / es
│  │  └─ zh-CN / zh-TW
│  └─ Bridge/MultiplayerBridgeHost.exe 自包含联机桥，由 Mod 自动启动
├─ src
│  ├─ MultiplayerBridge               TCP 主机/客户端网络核心
│  ├─ MultiplayerBridgeHost           自包含进程和受限 IPC
│  └─ MultiplayerBridge.SmokeTest      网络回环测试
└─ build.ps1                           编译、打包和安装
```

## 实现方式

- `main.ts` 由游戏自带的 Jint Mod 环境执行，只使用公开的日志、`ReadModFile`、UI 和 Hook API。
- `MultiplayerBridgeHost.exe` 是随包附带的 Windows x64 NativeAOT 程序，玩家无需安装 .NET。
- 游戏脚本用带专用标记的 `Player.log` 行提交短命令；桥接程序只增量读取新日志，并把状态和有界事件列表原子写入
  `Bridge/state.json`，脚本再通过受沙箱限制的 `ReadModFile` 读取。
- 网络消息使用 4 字节大端长度前缀加 UTF-8 JSON，单条上限 64 KiB，事件队列有上限。
- 主菜单入口复制游戏自己的 `newGame` 按钮，改名为“联机”，放在其正上方，因此样式、
  字体、悬停效果和菜单间距均继承原界面。
- UI 根据游戏的 `UserSelectedLanguage` / `Localization.Language` 自动读取
  `i18n/<语言缩写>/strings.json`；英语作为缺失文本的后备语言，切换语言无需重启。
- 建立房间时自动继续最近的有效联机存档；没有联机存档时才从零创建。
- 联机卡片使用底部“取消”按钮或 `Esc` 关闭，圆角边缘为完全不透明的硬边。

## 为什么不再使用 version.dll

旧版通过游戏根目录 `version.dll` 代理接入网络桥。游戏日志证明
`AntiTamperChecker.DelayedExit()` 会检测该文件并主动退出。v0.3.0 已移除这条注入路径，
不修改或绕过反篡改组件。v0.8.0 只通过游戏专用 Mod 启动器加载，并由 Mod 自动启动包内桥接程序。

## 构建

```powershell
.\build.ps1 -Install
dotnet run --project .\src\MultiplayerBridge.SmokeTest -c Release
```

发布物：`artifacts/PlayerHostedMultiplayer-v0.8.0-win-x64.zip`

## 玩家同步

- 房主作为星型转发中心，支持房主、客户端以及客户端之间互相显示。
- 以 5 Hz 发送场景、位置、朝向、移动、落地、动作、攻击、武器和 Animator 状态。
- 远端模型逐帧插值；大跨度移动自动校正，断线或跨场景后自动清理。
- 远端玩家使用本机当前角色可视模型作为安全映射模板，只保留 Animator 和渲染组件，不复制输入、相机、碰撞或游戏逻辑。
- 房主以 5 Hz 广播绝对游戏时间、日期、时段和 `timeOffset`；客户端本地的 `AddTime/AddDay/SetTime` 会被拦截，只接受房间权威时间。
- 睡一会和睡到明天都必须由所有已连接玩家在 20 秒内选择同一方式；桥接层仍有未确认玩家时不会批准跳夜。

## 线上存档隔离

- 联机界面不再显示“选择存档”或“新建线上存档”；建房时自动继续最近的有效联机存档，没有时才从零创建。
- 正式线上文件与游戏默认存档同在 `Saves` 目录，命名为 `MPOnline_<玩家UUIDv7>.save`；UUIDv7 每位玩家只生成一次并持续复用。
- 游戏运行时解包为 `MPActive_<玩家UUIDv7>.save` 工作副本；原版读取和保存窗口会过滤两种前缀。
- 旧版时间戳线上档会在首次建房时原地迁移为当前玩家的 UUIDv7 文件名，内容不会被解密或改写。
- 内层使用与游戏原版一致的 `Encrypted` 格式（PBKDF2-SHA256、AES-256-CBC、HMAC-SHA256），外层再使用 Mod 的 PBKDF2-SHA256 + AES-256-GCM 认证加密。
- 联机保存直接采集游戏的完整 `GetSave()` JSON，由桥接程序生成原版内层密文并原子写入工作副本，再验证和封装正式档；不会借用或覆盖单机 `AutoSave`。
- 退出游戏时桥接程序必须成功写入并验证正式档后才允许退出；`MPActive_` 工作档不会删除，若被原版流程删除还会从 `MPOnline_` 自动恢复。
- 重新进入时先由原版 `LoadGame` 恢复完整角色数据，再补应用只在游戏初始化阶段生效的场景、位置和朝向；角色碰撞控制器会把落在碰撞体内的旧坐标修正到最近合法点。
- 联机时隐藏暂停菜单的原版读取入口，并拦截 `SaveTab.DeleteSave`；即使其他 Mod 重新显示删除按钮，也不能删除线上档。
