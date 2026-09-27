# v0.13.0 验证报告

状态更新于 2026 年 9 月 27 日。本文把当前自动化检查与较早的真实游戏证据分开，避免用旧结果证明刚修改的存档流程。

## 当前自动化检查

当前 NativeAOT 桥通过：

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-save-crypto
```

```text
PASS UUIDv7 rename, read-only load transaction, single-file online save, clothing metadata, online-save crypto, temporary load copy, latest-save discovery, tamper rejection and AutoSave isolation
```

正式构建在生成包之前还会强制执行运行时安全扫描：拒绝会落入注册表的游戏偏好接口、Windows 注册表 API、提权请求以及常见安装器/包管理器命令。当前源码、生成的 `mod/main.ts` 和已安装负载均不包含这些 API；发布桥接程序与安装目录桥接程序的 SHA-256 完全一致。

该测试验证：

- `MPOnline_<UUIDv7>.save` 是正常情况下唯一持久存档。
- `MPActive` 只是原生格式临时加载副本，加载后会释放。
- `prepareSave` 会关闭写入；提交不完整快照返回 `-8`，正式完整文件逐字节不变。
- 保存直接原子提交到双层加密 `MPOnline` 容器。
- 桥接程序不再监视、转存、备份、恢复或修改 `AutoSave.save`。
- Mod 外层 AES-GCM 能正确往返并拒绝篡改文件。
- UUIDv7 迁移、最新存档发现和仅剩 Active 的旧版恢复通过。
- 加载元数据包含衣服列表，运行时角色可以重新应用已装备衣服，而不修改存档 JSON。

当前房间适配自检在测试服务器容量设为 2 时也已通过：

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe `
  --self-test-room-relay --address 127.0.0.1 --port 28783
```

测试服务器容量设为 2 时，该测试验证新服务器只显示一个真实房间、两个普通客户端将其坐满后服务器建立下一间、权威仍为 Peer `0`、成员 ID 为正数、双向转发正常，并由服务器负责时钟和全员睡眠批准。

```text
PASS public room auto-entry, server authority and bidirectional relay
```

## 真实游戏证据

| 证据 | 结论 | 路径 |
| --- | --- | --- |
| 两个真实游戏进程的局域网测试 | 分帧、握手、编号、双向状态/资料/实时数据和远端模型通过 | `artifacts/dual-instance/20260927-105653/evidence/summary.json` |
| 整理后的双游戏回归 | 非空衣服、晒黑肤色、182 个衣服骨骼、移动/动作和跨场景跟随通过 | `artifacts/dual-instance/20260927-111836/evidence/summary.json` |
| 暂停窗口可见测试 | UI 保持可见时 `Paused=false`、`timeScale=1`，世界继续运行，之后手机可正常打开 | `artifacts/dual-instance/20260927-111811/evidence/summary.json` |
| 较早的线上存档生命周期 | 旧“保留 Active”设计下的 UUIDv7 创建/重进、退出保存、位置恢复和桥接退出通过 | `artifacts/online-save/20260927-102017/evidence/summary.json` |
| NativeAOT 房间中继进程测试 | 两个客户端通过服务器权威创建/加入公开房间并交换数据 | `artifacts/room-relay-nativeaot-server.log` |

较早的线上存档证据早于“单一持久文件/只读加载事务”修改。它仍可证明游戏集成与位置加载，但**不能**证明新临时 Active 流程已经跑过真实游戏回归；新文件和写入锁语义目前由当前自检覆盖。

双游戏运行的其他观察结果：

- 玩家排程设置为 20 Hz；同机运行两份完整游戏时端到端实测 17.43 Hz，渲染插值仍逐帧执行。
- 当次材质恢复每端覆盖 14 个渲染器、21 个独立材质，无效/错误 Shader 为零。
- 历史双游戏测试前后原版 `AutoSave*.save` 哈希不变；当前源码进一步删除桥接 AutoSave 处理，并在线上模式取消原版写入器。
- 公网端点接受分帧协议并返回 `pong`，外部 TCP 可达性也已确认。

## 待验证项目

- 玩家端与 Ubuntu 服务更新到同一提交后，让两个真实游戏客户端通过已部署公网端点联机。
- 重复创建、床边保存、退出、重进流程，并确认加载后和退出后存档目录只包含 `MPOnline`。
- 确认床窗口出现原版样式的手动保存选项，并确认暂停菜单“退出”立即执行且不提交保存命令。
- 在线上自动保存与床边保存前后计算 `AutoSave.save` 哈希，验证目标游戏版本上的 Hook。
- 重进同一线上 UUID 后核对已装备衣服、背包、任务、成就/进度、位置和手机功能。
- 网络使用明文 TCP，尚未经过渗透测试，也未验证 TLS 终止方案。

## 发布包边界

玩家 ZIP 包含运行 Mod 文件、六种语言包、中英文玩家说明与许可、资料字段映射，以及一个自包含 NativeAOT 可执行程序；不包含源码、测试、安装器、系统服务、启动脚本、Node.js、.NET SDK、Visual Studio 或 Ubuntu 服务。持久输出仅限 Mod 自己的 JSON 快照、同目录下的异常崩溃日志，以及游戏存档目录中的线上文件；Mod 不使用 Windows 注册表。
