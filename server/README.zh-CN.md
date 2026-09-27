# Fallen Flower 房间服务器

这是 PlayerHostedMultiplayer v0.13.0 所需的公开房间权威与中继。它负责成员、逻辑 Peer `0`、5 Hz 房间时钟、场景裁决和全员睡眠批准；不运行游戏、不读取玩家存档，也不模拟 Unity 游戏逻辑。

> 协议是明文 TCP 上的分帧 JSON，不是 TLS。请限制管理接口、使用独立随机管理员令牌；需要传输保密时，应在服务前增加安全传输代理。

## 部署

需要 Ubuntu/Linux Docker 主机、Docker Engine 与 Compose，以及对配置端口（默认 `27777`）的入站 TCP 访问。主机不需要 .NET 或 Node.js。

从仓库根目录执行：

```bash
cd server
cp .env.example .env
nano .env
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100 room-server
```

健康服务会显示：

```text
Fallen Flower room server listening on 0.0.0.0:27777
```

在云安全组开放 TCP 27777。如果 UFW 已启用：

```bash
sudo ufw allow 27777/tcp
```

在 Windows 验证：

```powershell
Test-NetConnection <服务器地址> -Port 27777
```

## 配置

| 变量 | 默认值 | 范围/作用 |
| --- | --- | --- |
| `FF_ROOM_PORT` | `27777` | TCP 端口，1–65535 |
| `FF_ROOM_MAX_ROOMS` | `256` | 内存房间上限，1–10,000 |
| `FF_ROOM_MAX_PLAYERS` | `8` | 每房间玩家数，2–32 |
| `FF_ROOM_ADMIN_TOKEN` | 空 | 启用全部 `admin.*` 指令；至少 16 个字符 |

可用 `openssl rand -hex 32` 生成令牌。空令牌会关闭远程管理。不要提交 `.env`；Git 已忽略它，更新包也不应包含它。

无效配置会导致退出码 1；配合 `restart: unless-stopped` 时表现为循环重启。使用 `docker compose logs` 查看准确错误。

## 安全更新

Git 应始终由仓库所有者运行，不要交替使用 `root` 与 `ubuntu`。如果 `/opt/Multiplayer-Mod` 目前属于 root，可一次性修正：

```bash
sudo chown -R ubuntu:ubuntu /opt/Multiplayer-Mod
```

保留 `.env` 后更新：

```bash
cd /opt/Multiplayer-Mod
cp server/.env /tmp/fallen-flower-server.env
git pull --ff-only
cp /tmp/fallen-flower-server.env server/.env
cd server
sudo docker compose up -d --build --force-recreate
sudo docker compose ps
sudo docker compose logs --tail=100 room-server
```

不要通过全局信任任意路径来绕过 `dubious ownership`。统一目录所有权可以同时解决该警告和 `.env` 无权限问题。也可以重新 clone；替换运行中的 Compose 项目前，把原 `.env` 复制到新仓库的 `server/`。

## 协议与房间行为

每帧由 4 字节大端长度和 UTF-8 JSON 构成，最大 64 KiB。支持：

- `ping`
- `room.list`、`room.create`、`room.join`、`room.enter`、`room.info`、`room.send`
- `admin.stats`、`admin.room.kick`、`admin.room.close`、`admin.room.send`

服务器启动时建立一个真实公开房间。`room.list` 只返回服务器实际管理的房间及实时人数/容量。全部房间达到 `FF_ROOM_MAX_PLAYERS` 后，服务器自动建立下一个编号房间，并回收多余空房间。`room.enter` 无密码加入列表中的房间，且不接受客户端指定容量。公开玩家始终获得正数 ID 和 `authorityPeerId: 0`；第一名玩家也不是权威玩家。

公开房间中，服务器解析控制包类型，用认证连接覆盖玩家声明的 ID/名称，拒绝玩家时间权威，并协调时间/场景/睡眠；资料内容仍由客户端管理。在容量允许时，服务器始终保留一个可加入的空房间。

显式 `room.create`/`room.join` 房间为协议兼容保留创建者权威；创建者离开时房间关闭。

## 容器边界

运行镜像使用 Ubuntu Chiseled .NET 8、非 root 用户、移除全部 Linux capabilities、只读根文件系统和 `no-new-privileges`。房间状态只在内存中；替换或重启容器会清除已实例化房间、时钟和名单。

## 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `Restarting (1)` | 环境变量无效 | 查看日志，检查人数 2–32 和令牌长度 |
| TCP 测试失败 | 云防火墙、UFW 或 Compose 端口 | 开放 TCP，确认 `0.0.0.0:27777->27777/tcp` |
| `unknown command` | 旧服务器镜像 | 拉取匹配源码并重新构建，必要时禁用缓存 |
| 公开房间已满 | 达到容量 | 选择其他房间，或提高 `FF_ROOM_MAX_PLAYERS` 后重启 |
| `dubious ownership` 或 `.env` 无权限 | 仓库所有权混乱 | 让一个部署用户统一拥有 `/opt/Multiplayer-Mod` |
| 可以连接但行为不一致 | 版本不匹配 | 统一服务器、Mod 和游戏版本 |
