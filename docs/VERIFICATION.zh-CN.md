# 1.0.1 验证报告

## 自动化结果

验证日期：2026-09-28。

| 检查 | 结果 |
| --- | --- |
| `tools/Build-Mod.ps1 -Install` | 通过；NativeAOT 玩家桥已打包并安装 |
| 房间服务器 Release 编译 | 通过；0 warning、0 error |
| 联机桥 Release 编译 | 通过；0 warning、0 error |
| 桥接宿主 Release 编译 | 通过；0 warning、0 error |
| 直连 `MultiplayerBridge.SmokeTest` | 通过 |
| 独立房间端到端测试 | 通过 |
| 独立运行日志自检 | 通过 |
| `git diff --check`、源码/语言/安全构建门禁 | 通过 |

房间端到端测试覆盖常驻房、Peer ID 复用、双向中继、单人/多人全员睡眠、失联/挂机超时、请求限流、服务器权威包伪造拒绝、公开资料分片拒绝，以及服务器绝不广播 `worldTime`。

## 构建强制的防回归项

正式版构建会拒绝：

- 注册表、提权和安装器 API；
- 拦截原版 `PlayerStatus.SetTime/AddTime/AddDay` 剧情事务；
- 写入 `timeScale`、游戏时间、时段偏移或剧情日期；
- 人工拼接 `StartGame`/`GameManager.LoadGame`；
- 没有在同一帧完成初始化、读档与隐藏选择框的原版默认读档流程；
- 硬编码 `SaveGame("AutoSave")` 而忽略当前原版槽位；
- Game Mod 模块遗漏/重复和六种语言键不一致。

## 存档路径核对

运行时在同一帧初始化原版读取器、调用 `LoadSaveWindow.Load("AutoSave")` 并隐藏选择框，不创建新游戏状态、不枚举存档文件，也没有桥接存档命令。自动保存、床边保存和退出沿用游戏原版流程。旧 `MPOnline`/`MPActive` 不会被访问。

## 安全回归

普通玩家不能直接指定其他公开 Peer、伪造服务器专属包、通过资料分片伪造身份、向名字注入控制字符/富文本标签、无限超速请求，或永久占住未认证/发送连接。玩家资料只允许外观与聚合数量，不再广播完整存档 JSON。

## 真实游戏验收清单

生成包已安装到 `D:\FallenFlower\Mods\PlayerHostedMultiplayer`。广泛分发前应在当前游戏版本实测：加入时不出现存档框；读档后衣服、任务、交互点正常；床边与自动保存正常；单人/双人睡眠；课程结束不锁控制；正常退回菜单/桌面；手机高度与通讯录正常。这些 Unity/IL2CPP 行为不能只靠无界面的 .NET 测试证明。
