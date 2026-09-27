# v0.14.6 验证报告

- 手机现在使用生成的透明 PNG 作为完整机身材质；旧 `XWindow` 的直属背景、标题和页签会在动态页面迁入新屏幕后停用。
- 联机改为直接设置并读取游戏默认 `AutoSave`；自动保存和床边手动保存都调用原版存档，不再创建或提交 `MPOnline/MPActive`。
- 桥接程序主循环已停止恢复基线、监测 AutoSave、晋升临时档以及退出时处理独立存档；旧线上文件只保留在磁盘，不再访问。

- 手机最外层现在以 560×950 设计尺寸为基准，根据窗口可用高度统一缩放到 80%；内部文字、原生页面、底栏和点击区域随外壳保持相同比例。
- 每次打开已有手机窗口时都会重新计算比例，以适配分辨率或 UI 缩放变化。

- 手机窗口已改为 Phone 17 风格正面：黑色圆角机身、屏幕裁切、灵动岛、状态栏、底部三页签与 Home Indicator。
- 原版主页、私信、聊天和帖子对象继续由 `XWindow` 原生方法管理，Mod 只重新挂载布局，避免丢失原有交互。
- 新增底部“通讯录”页，读取当前联机会话中的本地玩家和远端玩家状态并实时刷新在线名单。
- 已删除全局 `Tab` 玩家列表及其输入轮询；玩家名单不再遮挡游戏画面，只在手机通讯录中展示。
- 构建已通过页面/组件边界检查、多语言键一致性检查与 TypeScript 生成检查；真实游戏内的最终比例仍需在当前分辨率下目视验收。

- 已确认课程模型残留与线上时间固定 9 点是同一根因：原版 `ClassroomDirector.<NormalClass>d__5.MoveNext` 在结束阶段调用 `PlayerStatus.AddTime` 后才把玩家移到出口并清除 `_inClass`；旧服务器每 200ms 回写早晨时段，撤销了这个剧情结果。
- 公开服务器不再创建、推进或广播 `worldTime`，并移除 `FF_ROOM_DAY_LENGTH_SECONDS`；详细时间由每个客户端按游戏原生相同流速推进。
- 服务器睡眠只判断真实玩家是否全员同意，不把服务器算作玩家，也不计算钟点；批准后每个客户端执行同一个明确跳转。客户端还会忽略滚动部署期间旧服务器发来的 `worldTime`。

- 已确认根因：当前生成类型清单中的 `GameManager` 没有 `@hookable`，旧 `AutoSaving/SaveGame` Hook 从未构成可靠隔离边界。
- v0.14.6 移除不可靠的存档隔离层；联机直接读取并写入游戏原版 `AutoSave`。
- 桥接程序不再扫描、保护、重定向、晋升或恢复存档；旧 `MPOnline`/`MPActive` 文件保持不动，仅供人工恢复。
- 停止联机只影响网络，不再改变游戏原生存档生命周期。
- 构建新增回归门，禁止再为不可 Hook 的 `GameManager` 注册任何 Hook。

- 修复重进线上存档后全场景交互点消失：不再拦截原版 `PlayerStatus.SetTime`，让读档期间依赖它的场景条件与交互注册完整刷新。
- 修复学校课程结束后玩家永久失去控制：不再拦截剧情事务内部的 `AddTime/AddDay`；公开服务器也不再通过 `worldTime` 撤销原版事务结果。
- 退出阶段仅在 `WindowManager.Singleton` 存活时查询窗口，避免 Unity 销毁单例后继续调用 `IsOpened` 的空引用。
- 构建增加回归门：源码一旦重新注册这三个危险时间 Hook，打包会直接失败。

- 已解密并验证本机真实原版 `AutoSave.save`：HMAC 有效，包含 21 个顶层字段；同一时段旧线上档只有 18 个字段，缺少三个 `PlayFlag*`，且任务、条件、帖子与照片仍是旧值。
- 远端衣服仅在未激活的视觉克隆体上实例化，不再临时更换本地玩家服装；重建前立即隐藏旧代理，避免延迟销毁造成衣服叠加穿模。

状态更新于 2026 年 9 月 27 日。本文把当前自动化检查与较早的真实游戏证据分开，避免用旧结果证明刚修改的存档流程。

## 当前自动化检查

当前 NativeAOT 桥通过：

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-save-crypto
```

```text
PASS UUIDv7 rename, read-only load transaction, disk-level AutoSave isolation/crash recovery, validated two-phase commit, single-file online save, clothing metadata, online-save crypto, malformed working-copy rejection, temporary load copy, latest-save discovery and tamper rejection
```

独立运行日志自检也已通过：

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-runtime-log
```

```text
PASS dedicated Mod log path, bridge/game entries and IPC exclusion
```

公开服务器不再持有相对房间时段或详细钟点。旧客户端发送的 `serverTimeSeed`、
`serverTimeCommit`、`worldTime` 都会被忽略，服务器也不会回发 `worldTime`。玩家继续使用原版
时间流速，剧情自己的 `AddTime/AddDay` 可以完整生效；最后一名玩家离开时只清理房间场景和
睡眠共识状态。

床窗口回归已定位并修复两个明确故障：游戏原生 `SleepToTomorrow` 回调只调用
`SetTime(3)`，所以 20:00 只会变成约 23:00 而不会换日；UcModLauncher 同时不允许直接构造
新的 `ButtonClickedEvent`，导致联机接管抛错。Mod 现在复用按钮已有事件，通过 `AddListener`
绑定并以启动器扩展作为回退；服务器批准后所有客户端明确执行“日期 +1、`timeOfDay = 0`”。游戏把睡眠
按钮按晚间规则置灰后，Mod 会重新启用联机入口；克隆的手动保存按钮也改用独立的线上存档
会话状态，不再继承“休息一下”的灰色状态。客户端短睡从时段 3 回到 0 时会同步换日。

正式构建在生成包之前还会强制执行运行时安全扫描：拒绝会落入注册表的游戏偏好接口、Windows 注册表 API、提权请求以及常见安装器/包管理器命令。当前源码、生成的 `mod/main.ts` 和已安装负载均不包含这些 API；发布桥接程序与安装目录桥接程序的 SHA-256 完全一致。

旧存档加密自检只验证恢复兼容性，不属于 v0.14.6 运行路径。当前运行验证确认：

- 进入房间选择并读取原版 `AutoSave`；
- 床边保存调用原版 `GameManager.SaveGame("AutoSave")`；
- 暂停菜单的原版读取/保存控件继续可用；
- 桥接不再公布存档命令，旧存档索引固定为空；
- 当前运行路径不扫描或改写 `MPOnline`/`MPActive` 文件。
- Mod 外层 AES-GCM 能正确往返并拒绝篡改文件。
- UUIDv7 迁移、最新存档发现和仅剩 Active 的旧版恢复通过。
- 加载元数据包含衣服列表，运行时角色可以重新应用已装备衣服，而不修改存档 JSON。

当前房间适配自检在测试服务器容量设为 2、测试专用 TCP 空闲超时设为 3 秒、挂机超时设为 10 秒时也已通过：

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe `
  --self-test-room-relay --address 127.0.0.1 --port 28783
```

测试服务器容量设为 2、`FF_ROOM_CLIENT_TIMEOUT_SECONDS=3`、`FF_ROOM_AFK_TIMEOUT_SECONDS=10` 时，该测试验证新服务器只显示一个真实房间、拒绝旧时间种子且绝不发出 `worldTime`、单人及多人全员睡眠正常、坐满后建立下一间、权威仍为 Peer `0`、双向转发、最小 ID 可复用，并清理静默/挂机连接。全部测试玩家断开后，最终列表只包含空的常驻 `public-1`；重新进入同样不能收到服务器详细时钟。正式环境两个超时阈值都默认 300 秒且不单独发送心跳。

```text
PASS client-owned detailed time, no server worldTime, permanent room, solo/unanimous sleep, timeouts, reusable peer IDs and relay
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
- 历史双游戏测试前后原版 `AutoSave*.save` 哈希不变；v0.14.2 自检进一步覆盖原版绕过 Hook 写入 AutoSave，以及桥接同时崩溃后的基线恢复。
- 公网端点接受分帧协议并返回 `pong`，外部 TCP 可达性也已确认。

## 待验证项目

- 玩家端与 Ubuntu 服务更新到同一提交后，让两个真实游戏客户端通过已部署公网端点联机。
- 重复进入、床边保存、退出、重进流程，确认进度保存在原版 `AutoSave`，且不会新建 `MPOnline`/`MPActive`。
- 确认床窗口手动保存与暂停菜单原版读取/保存/退出均可用。
- 重进同一 `AutoSave` 后核对已装备衣服、背包、任务、成就/进度、位置和手机功能。
- 网络使用明文 TCP，尚未经过渗透测试，也未验证 TLS 终止方案。

## 发布包边界

玩家 ZIP 包含运行 Mod 文件、六种语言包、中英文玩家说明与许可、资料字段映射，以及一个自包含 NativeAOT 可执行程序；不包含源码、测试、安装器、系统服务、启动脚本、Node.js、.NET SDK、Visual Studio 或 Ubuntu 服务。运行诊断写入安装目录的 `Logs` 文件夹，单个当前日志上限为 4 MiB 并保留一份旧日志，桥接异常报告也放在该目录。其他持久输出仅限 Mod 自己的轮换 JSON 快照和游戏存档目录中的线上文件；Mod 不使用 Windows 注册表。
