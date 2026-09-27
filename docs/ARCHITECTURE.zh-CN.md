# 架构说明

项目包含两条网络路径：生产使用 Ubuntu 权威/中继的公开房间，同时保留本地直连“建立/加入”。两者都使用随包 Windows 桥接程序，不向游戏注入 DLL。

## 运行组件

```mermaid
flowchart LR
    GameA[游戏 + Jint Mod] -->|Player.log 标记命令| BridgeA[NativeAOT 桥]
    BridgeA -->|轮换状态 JSON| GameA
    GameB[游戏 + Jint Mod] -->|Player.log 标记命令| BridgeB[NativeAOT 桥]
    BridgeB -->|轮换状态 JSON| GameB
    BridgeA <-->|明文分帧 TCP| Server[Ubuntu 房间权威服务]
    BridgeB <-->|明文分帧 TCP| Server
    GameA --> SaveA[UUIDv7 MPOnline 存档]
    GameB --> SaveB[UUIDv7 MPOnline 存档]
```

- `src/GameMod/`：Unity UI、Hook、存档生命周期、线上时间显示和玩家/资料同步。
- `src/MultiplayerBridge/`：本地直连 TCP、独立房间客户端适配和有界队列。
- `src/MultiplayerBridgeHost/`：进程生命周期、日志命令 IPC、轮换状态快照、端点解码和存档加密。
- `src/MultiplayerRoomServer/`：公开房间成员、时钟/场景/睡眠控制和数据转发。
- `mod/main.ts` 与 `mod/i18n/` 是生成的运行副本，应修改 `src/GameMod/`。

桥接程序以当前普通用户启动，不使用注册表 IPC，也不申请提权。游戏到桥接的命令写成 Unity `Player.log` 中的单行专用标记；桥接到游戏使用三个轮换 JSON 快照，避免 Jint 读取与写入竞争。

## 权威与同步

| 数据 | 公开房间权威来源 | 频率/路径 |
| --- | --- | --- |
| 成员与认证玩家 ID | Ubuntu 服务器 | 连接生命周期 |
| 位置、旋转、动作、武器、Animator 层 | 玩家本人 | 20 Hz 快照；逐渲染帧插值 |
| 衣服、捏脸、完整资料快照 | 玩家本人 | 每 2 秒修订资料；必要时分片 |
| 生命、耐力、金钱、日期/时间显示和场景 | 玩家本人 | 每 0.5 秒实时资料 |
| 世界时钟 | Ubuntu 服务器 Peer `0` | 5 Hz 锚点 |
| 房间场景 | Ubuntu 服务器 Peer `0` | 比较交换请求/广播 |
| 睡眠推进 | Ubuntu 服务器 Peer `0` | 全员相同请求、批准与提交 |
| 线上存档 | 玩家本机 | UUIDv7 文件；不会作为文件发送给服务器 |

服务器校验房间信封与已经认证的成员身份。公开流量中，它会替换玩家声明的 ID/名称、拒绝玩家时间权威，并处理时间/场景/睡眠控制包；它不模拟 Unity 物理、战斗、任务或背包。

完整资料传输用于远端外观和玩家信息页面，不会把其他玩家的进度应用到本机存档。

## 房间生命周期

1. 服务器启动时建立一个真实公开房间；`room.list` 只返回实际房间、实时人数和服务器指定的容量。
2. `room.enter` 无密码加入列表中的房间；客户端不能指定公开房间容量。
3. 服务器始终是逻辑 Peer `0`；玩家获得当前最小的空闲正数成员 ID，成员离开后包括 `1` 在内的编号立即可复用。
4. 全部公开房间满员后，服务器建立下一个编号房间；多余空房间会被回收，同时保留一个可加入的空房间。
5. `room.create`/`room.join` 仍供显式房间和兼容客户端使用；游戏内本地“建立/加入”使用直连 `BridgeNode` TCP。
6. 本地直连仍由玩家房主权威控制，并可能需要入站网络配置；公开模式不会把权威交给玩家。

每帧由 4 字节大端长度和 UTF-8 JSON 构成，最大 64 KiB。传输是明文 TCP，不是 TLS。AES-GCM 端点混淆只隐藏可编辑配置，不会加密网络数据包。

## 存档事务

```mermaid
sequenceDiagram
    participant G as 游戏 Mod
    participant B as 桥接程序
    participant D as 存档目录
    G->>B: prepareSave(MPOnline UUID)
    B->>D: 认证并解密 MPOnline
    B->>D: 创建临时 MPActive
    Note over G,B: 写入锁保持关闭
    G->>G: LoadGame(MPActive)
    G->>B: releaseSave
    B->>D: 删除 MPActive
    G->>B: enableSaveWrites
    G->>G: 拦截 SaveGame("AutoSave")
    G->>B: 提交 GetSave JSON
    B->>D: 原子替换 MPOnline
    G->>G: 床边“保存游戏”复用同一提交路径
```

正常情况下只有 `MPOnline_<UUIDv7>.save` 持久存在。之所以短暂生成 `MPActive`，只是因为游戏无法读取 Mod 的认证外层容器。准备和加载期间，游戏脚本与桥接程序都会拒绝写入；加载失败时正式线上档逐字节保持不变。

线上自动保存不会调用原版磁盘写入器。Mod 会取消 `SaveGame("AutoSave")`，捕获内存 JSON，然后提交双层加密线上档。线上流程不会读取、创建、备份或恢复单机 `AutoSave.save`。

暂停菜单退出保持原版行为，不触发额外保存。桥接进程结束时只删除解密的 `MPActive` 临时副本，
不会把退出时的半完成状态写回正式档。玩家需要主动保存时可使用床窗口新增的原版样式按钮；
该按钮与线上自动保存调用同一原子提交实现。

## 源码合并

UcModLauncher 只加载一个 Jint 脚本，不能解析 TypeScript 模块。`build.ps1` 会检查 `src/GameMod/source-order.json` 是否恰好包含每个 `.ts` 文件一次，合并生成 `mod/main.ts`，校验页面/组件边界，并检查六种语言的翻译键完全一致。
