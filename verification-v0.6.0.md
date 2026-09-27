# v0.6.0 Mod 启动器集成验证

验证日期：2026-09-27

## 结论

v0.6.0 不再向玩家分发启动、安装或卸载脚本。游戏专用 Mod 启动器加载 `main.ts` 后，
Mod 会从自身 `Bridge` 目录自动启动自包含的 `MultiplayerBridgeHost.exe`。

## 静态证据

- ZIP 文件清单中不存在 `.cmd`、`.bat`、`.ps1` 或 `MultiplayerBridge.dll`。
- 玩家包内唯一的原生运行文件是 `Bridge/MultiplayerBridgeHost.exe`。
- 桥接程序以 Windows x64 NativeAOT 单文件、自包含方式发布。
- `main.ts` 优先使用启动器注入的 `__dirname` 定位桥接程序；旧启动器才退回默认 Mods 路径。

## 动态证据

- 用 UcModLauncher 对游戏使用的 `--enable-mods --mod-plan` 参数启动游戏。
- `Player.log` 记录 Mod 加载、语言包加载、主菜单联机按钮创建和自动启动桥接路径。
- 运行中观察到桥接进程路径为
  `D:/FallenFlower/Mods/PlayerHostedMultiplayer/Bridge/MultiplayerBridgeHost.exe`。
- 网络回环自检通过：主机监听、客户端连接和 peerId 分配正常。
- 线上存档自检通过：外层加密、篡改拒绝、自动存档重定向和单机存档恢复正常。
- 保持 UcModLauncher 运行并关闭游戏后，桥接程序在 5 秒宽限期后自行退出，监听端口释放。
- 退出清理会删除中断进场产生的零字节 `MPActive_` 临时文件。
- 删除已安装的 `Bridge/state.json` 后进行首次启动复现：Mod 无执行错误，桥接程序成功自动启动。
- 建房进场等待使用 `DontDestroyOnLoad` UI 下的常驻协程组件，不再依赖会随场景销毁的 MainMenu。
- 桥接退出后保留心跳为 0 的离线状态哨兵，下一次启动不会因缺少状态文件而中断。

## 范围边界

本次验证覆盖单机上的 Mod 加载、桥接自动启动和本机网络回环。公网联机仍取决于房主防火墙、
路由器端口映射或组网工具；尚未替代两台真实玩家电脑的完整联机游玩测试。
