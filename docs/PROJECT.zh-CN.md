# Fallen Flower Multiplayer 1.0.0

这是《Fallen Flower》的独立房间服务器联机 Mod。公开房间由 Linux 服务管理，本地“建立/加入”直连模式仍然保留。

## 安装与使用

1. 用游戏 Mod 启动器导入 `artifacts/PlayerHostedMultiplayer-v1.0.0-win-x64.zip`。
2. 从启动器运行游戏，主菜单选择“联机”。
3. 输入显示名，打开公开服务器列表并进入房间。

玩家包已经包含自包含 Windows x64 桥接程序，不要求另装 .NET、Node.js、Visual Studio，也不提权、不安装服务、不修改注册表。Mod 版本显示在主菜单游戏版本号左侧，来源与 ZIP 文件名均为 `mod/info.json`。

## 正式版行为

- `public-1` 是常驻房间；无人在线时仍出现在列表中。全部可加入房间满员后才自动建立新房，多余空房会回收。
- 服务器是逻辑 Peer `0`。普通玩家只能使用正数 ID，不能伪造服务器场景、名单、欢迎、离开或睡眠批准包。
- 服务器只协调成员、场景和全员睡眠，不持有详细钟点、不修改日期或 `timeScale`。线上时间使用每个客户端的原版默认流速，剧情自己的 `SetTime/AddTime/AddDay` 保持原样。
- 单人房间只计算这一名真实玩家；服务器不算玩家。多人房间要所有当前玩家选择相同睡眠方式才批准。
- 加入后直接调用原版 `LoadSaveWindow.Load("AutoSave")`，不会点击“读取游戏”按钮，也不会打开存档选择框。自动保存、床边保存、暂停菜单保存和退出继续使用游戏原版槽位。
- 桥接程序不创建、读取、重定向、加密或晋升 `MPOnline/MPActive`。旧文件保留在磁盘仅供手工恢复，当前版本不会访问。
- 网络只传远端显示需要的衣服、捏脸、动作、实时状态和进度数量，不广播完整剧情、联系人或完整 `GameManager.GetSave()`。
- 手机整体限制为屏幕高度的 80%，包含主页、消息、通讯录；通讯录显示当前线上玩家。

Mod 日志位于 `Mods/PlayerHostedMultiplayer/Logs/PlayerHostedMultiplayer.log`，最大 4 MiB，保留一份轮换日志；桥接崩溃日志也写入同一目录。

## 安全边界

公开协议是带长度前缀的明文 TCP JSON，不是 TLS。客户端内置端点只做 AES-GCM 混淆，不能当成秘密。服务器限制帧大小、连接数、请求速率、加入时限、发送时限和文本内容，并以认证连接覆盖客户端自报身份。不要把敏感密码复用为管理令牌。

详见[安全说明](SECURITY.md)、[协议与错误码](PROTOCOL.zh-CN.md)、[验证报告](VERIFICATION.zh-CN.md)和[服务器部署](../server/README.zh-CN.md)。

## 构建

```powershell
./tools/Build-Mod.ps1 -Install
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-runtime-log
```

服务器直接走 Docker 自动部署，不生成服务器 ZIP。
