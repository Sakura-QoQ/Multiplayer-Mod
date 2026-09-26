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
│  ├─ Start-Multiplayer.cmd           安全启动管理器与网络桥
│  └─ Install-/Uninstall-*            玩家安装和卸载脚本
├─ src
│  ├─ MultiplayerBridge               TCP 主机/客户端网络核心
│  ├─ MultiplayerBridgeHost           自包含进程和受限 IPC
│  └─ MultiplayerBridge.SmokeTest      网络回环测试
└─ build.ps1                           编译、打包和安装
```

## 实现方式

- `main.ts` 由游戏自带的 Jint Mod 环境执行，只使用公开的 `PlayerPrefs`、`ReadModFile`、UI 和 Hook API。
- `MultiplayerBridgeHost.exe` 是随包附带的 Windows x64 NativeAOT 程序，玩家无需安装 .NET。
- 游戏脚本用专用 PlayerPrefs 键提交短命令；桥接程序把状态和有界事件列表原子写入
  `Bridge/state.json`，脚本再通过受沙箱限制的 `ReadModFile` 读取。
- 网络消息使用 4 字节大端长度前缀加 UTF-8 JSON，单条上限 64 KiB，事件队列有上限。
- 主菜单入口复制游戏自己的 `newGame` 按钮，改名为“联机”，放在其正上方，因此样式、
  字体、悬停效果和菜单间距均继承原界面。
- UI 根据游戏的 `UserSelectedLanguage` / `Localization.Language` 自动读取
  `i18n/<语言缩写>/strings.json`；英语作为缺失文本的后备语言，切换语言无需重启。
- “选择存档”通过桥接程序枚举本机存档名称并在卡片内显示；不会读取文件内容。
- 已加载存档的预览调用 `GameManager.GetSave()`，明文仅留在游戏进程内存，不自动上传或写回。
- 联机卡片使用底部“取消”按钮或 `Esc` 关闭，圆角边缘为完全不透明的硬边。

## 为什么不再使用 version.dll

旧版通过游戏根目录 `version.dll` 代理接入网络桥。游戏日志证明
`AntiTamperChecker.DelayedExit()` 会检测该文件并主动退出。v0.3.0 已移除这条注入路径，
不修改或绕过反篡改组件。安装脚本升级时只会删除带本 Mod 内部标记的旧代理。

## 构建

```powershell
.\build.ps1 -Install
dotnet run --project .\src\MultiplayerBridge.SmokeTest -c Release
```

发布物：`artifacts/PlayerHostedMultiplayer-v0.4.0-win-x64.zip`

## v0.4.0 玩家同步

- 房主作为星型转发中心，支持房主、客户端以及客户端之间互相显示。
- 以 5 Hz 发送场景、位置、朝向、移动、落地、动作、攻击、武器和 Animator 状态。
- 远端模型逐帧插值；大跨度移动自动校正，断线或跨场景后自动清理。
- 远端玩家使用本机当前角色可视模型作为安全映射模板，只保留 Animator 和渲染组件，不复制输入、相机、碰撞或游戏逻辑。

## 线上存档隔离

- “新线上存档”始终调用游戏的新游戏流程，从零创建，不复制单机存档。
- 正式线上文件与游戏默认存档同在 `Saves` 目录，命名为 `MPOnline_<时间戳>.save`。
- 游戏运行时只解包为 `MPActive_<时间戳>.save` 临时文件；原版读取和保存窗口会过滤两种前缀。
- 内层完整保留游戏原生 `Encrypted` 密文，外层使用 Mod 的 PBKDF2-SHA256 + AES-256-GCM 认证加密。
- 退出游戏时桥接程序完成最后一次封装并删除临时文件。
- 游戏原版 `AutoSaving()` 固定写 `AutoSave.save`；联机期间桥接程序会把这次写入转存到当前线上临时档，并立即恢复玩家进入联机前的单机 `AutoSave.save`。
