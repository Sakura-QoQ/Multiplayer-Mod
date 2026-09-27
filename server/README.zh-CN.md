# Fallen Flower Docker 房间服务器

这是 PlayerHostedMultiplayer 的房间控制与转发服务。服务器不运行游戏、不读取存档、不模拟世界，也不解析玩家状态；只管理房间并转发不透明数据。

房间不存在玩家房主。创建者和后来加入的玩家都是拥有正数 `peerId` 的普通成员。只有服务器能够通过经过管理员令牌验证的 `admin.*` 指令踢人、关闭房间或发送服务器消息。即使成员数量变成 0，房间也会继续保留。

## 环境要求

- Ubuntu 或其他受 Docker 支持的 Linux 主机
- Docker Engine 和 Compose 插件
- 在防火墙或云安全组开放 TCP 端口，默认 `27777`

主机不需要安装 .NET SDK、.NET 运行时、Node.js 或 Windows 构建工具。

## 启动

把项目复制到服务器，进入 `server` 文件夹后执行：

```bash
cp .env.example .env
docker compose up -d --build
```

查看状态与日志：

```bash
docker compose ps
docker compose logs -f room-server
```

停止或更新：

```bash
docker compose down
docker compose up -d --build
```

## 配置

启动前编辑 `server/.env`：

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `FF_ROOM_PORT` | `27777` | 对外 TCP 端口及容器监听端口 |
| `FF_ROOM_MAX_ROOMS` | `256` | 最大同时存在的房间数 |
| `FF_ROOM_MAX_PLAYERS` | `8` | 每个房间的最大玩家数 |
| `FF_ROOM_ADMIN_TOKEN` | 空 | 启用 `admin.stats`；至少使用 16 位随机字符 |

不要提交 `.env`；项目 `.gitignore` 已经排除该文件。

## 容器安全设置

最终镜像使用不带 Shell 的 Ubuntu Chiseled .NET 运行时，以非 root 用户运行，删除全部 Linux capabilities，根文件系统只读，并启用 `no-new-privileges`。房间状态会在容器运行期间一直保存在服务器内存里，空房间也不会删除；重新启动或替换容器仍会清空这些内存状态。

## 协议

每条消息由 4 字节大端长度和 UTF-8 JSON 组成，单帧最大 64 KiB。

支持的指令：

- `ping`
- `room.list`
- `room.create`
- `room.join`
- `room.info`
- `room.send`
- `admin.stats`
- `admin.room.kick`
- `admin.room.close`
- `admin.room.send`

`room.send` 携带不透明字符串，服务器不会解析游戏数据。

普通成员指令不能执行管理操作。所有管理指令都必须提供 `FF_ROOM_ADMIN_TOKEN`；令牌为空时远程管理功能关闭。服务器不会因为房间为空或长时间没有流量而删除房间；只有 `admin.room.close` 或服务器进程停止才会关闭房间。

此协议与当前玩家直连协议相互独立。还需要给 Mod 增加“独立服务器客户端模式”，玩家才能通过该容器建立和加入房间。
