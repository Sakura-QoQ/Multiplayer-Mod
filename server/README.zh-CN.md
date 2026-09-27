# Fallen Flower 独立房间服务器

这是 PlayerHostedMultiplayer v0.12.0 必需的 Docker 公开房间权威服务。服务器不运行游戏、不读取存档，也不模拟 Unity 游戏逻辑；它校验数据包信封与成员身份，协调统一时间/场景/睡眠，并在不解释存档资料字段的情况下转发玩家数据。

服务器固定为逻辑权威 Peer `0`，负责成员、5 Hz 房间时钟、场景裁决、全员睡眠批准与管理操作。所有玩家都只是正数 ID 的普通成员；任何玩家退出都不会把权限转交给别人，也不会关闭公开房间。

## 环境要求

- Ubuntu 或其他受 Docker 支持的 Linux 主机
- Docker Engine 和 Compose 插件
- 在防火墙或云安全组开放 TCP 端口，默认 `27777`

主机不需要安装 .NET SDK、.NET 运行时、Node.js 或 Windows 构建工具。

## 快速启动

把项目复制到服务器，进入 `server` 文件夹后执行：

```bash
cp .env.example .env
nano .env
sudo docker compose up -d --build
```

查看状态与日志：

```bash
sudo docker compose ps
sudo docker compose logs --tail=100 room-server
```

停止或更新：

```bash
sudo docker compose down
sudo docker compose up -d --build --force-recreate
```

## 配置

启动前编辑 `server/.env`：

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `FF_ROOM_PORT` | `27777` | 对外 TCP 端口及容器监听端口 |
| `FF_ROOM_MAX_ROOMS` | `256` | 最大同时存在的房间数 |
| `FF_ROOM_MAX_PLAYERS` | `8` | 每个房间的最大玩家数 |
| `FF_ROOM_ADMIN_TOKEN` | 空 | 启用全部 `admin.*` 指令；至少使用 16 位随机字符 |

不要提交 `.env`；项目 `.gitignore` 已经排除该文件。

可用 `openssl rand -hex 32` 生成管理员令牌。`FF_ROOM_MAX_PLAYERS` 必须在 `2` 到 `32` 之间；
超出范围会导致容器以退出码 1 反复重启。

## 公网访问

在云防火墙或安全组开放配置的 TCP 端口。如果 UFW 已启用，再执行：

```bash
sudo ufw allow 27777/tcp
```

在 Windows 玩家电脑验证：

```powershell
Test-NetConnection 3.10.232.221 -Port 27777
```

`TcpTestSucceeded : True` 表示 TCP 可达。健康容器还会输出：

```text
Fallen Flower room server listening on 0.0.0.0:27777
```

## 升级 v0.12.0

服务器更新包不包含 `server/.env`，因此不会覆盖现有配置。把更新包上传到 `/tmp` 后执行：

```bash
sudo unzip -o /tmp/FallenFlowerRoomServer-v0.12.0-source.zip -d /opt
cd /opt/Multiplayer-Mod/server
sudo docker compose up -d --build --force-recreate
sudo docker compose ps
sudo docker compose logs --tail=100 room-server
```

v0.12.0 服务器启动后，“公开服务器”会显示固定房间及实时人数/容量。玩家从列表选择房间；
端点与房间 ID 已内置，公开房间不使用密码。

## 容器安全设置

最终镜像使用不带 Shell 的 Ubuntu Chiseled .NET 运行时，以非 root 用户运行，删除全部 Linux capabilities，根文件系统只读，并启用 `no-new-privileges`。房间状态保存在服务器内存中；重新启动或替换容器会清空这些状态。

## 房间生命周期与协议

每条消息由 4 字节大端长度和 UTF-8 JSON 组成，单帧最大 64 KiB。

支持的指令：

- `ping`
- `room.list`
- `room.create`
- `room.join`
- `room.enter`（公开服务器按钮使用的原子创建或加入指令）
- `room.info`
- `room.send`
- `admin.stats`
- `admin.room.kick`
- `admin.room.close`
- `admin.room.send`

`room.send` 携带 JSON 字符串。公开房间中，服务器会读取控制类型、用已经认证的连接覆盖成员
ID/名称、拒绝玩家时间权威，并处理场景/时间/睡眠控制包；完整存档资料字段仍由客户端管理。

普通成员指令不能执行管理操作。所有管理指令都必须提供 `FF_ROOM_ADMIN_TOKEN`；令牌为空时远程管理功能关闭。公开房间只会被管理员关闭，或随服务器进程停止；空房间仍会保留。

服务器为玩家分配正数 ID，并在 `room.ready` 返回 `authorityPeerId: 0` 与 `serverAuthority: true`。
玩家状态/资料包中的 `ownerId` 会被服务器替换为已经认证的连接 ID，普通成员不能冒充其他玩家。

## 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 容器显示 `Restarting (1)` | 配置值无效 | 查看 `docker compose logs`，确认 `FF_ROOM_MAX_PLAYERS` 为 2–32 |
| TCP 测试失败 | 云防火墙或端口映射错误 | 开放 TCP 27777，并确认 Compose 显示 `0.0.0.0:27777->27777/tcp` |
| Mod 提示 `unknown command` | 服务器版本低于 v0.12.0 | 上传本版服务器源码并重新构建容器 |
| 公开房间已满 | 达到了每房间人数上限 | 选择另一个公开服务器，或调高 `FF_ROOM_MAX_PLAYERS` 后重启 |
| 所有玩家同时断开 | 网络或服务器中断 | 检查容器；普通玩家退出不会关闭公开房间 |
