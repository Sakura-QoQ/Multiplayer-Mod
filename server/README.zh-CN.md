# Fallen Flower 房间服务器

这是 PlayerHostedMultiplayer 的公开房间权威与中继。它负责成员、逻辑 Peer `0`、场景裁决和全员睡眠批准；不持有详细游戏时间，也不运行游戏、不读取玩家存档或模拟 Unity 游戏逻辑。

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

## GitHub Actions 自动部署

仓库的 `.github/workflows/deploy-server.yml` 会在 `main` 分支中的服务端源码、Compose 或 Docker 配置变化后自动部署，也支持从 Actions 页面手动执行。部署任务通过 SSH 登录服务器，由服务器克隆私有仓库；首次部署后则同步到触发工作流的准确提交。随后依次验证 Compose 配置、关闭旧容器、重新构建镜像并启动新容器。

服务器建议使用专用普通用户 `deploy`。该用户必须拥有 `/opt/Multiplayer-Mod`，并具有直接运行 `docker compose` 的权限：

```bash
sudo adduser --disabled-password --gecos '' deploy
sudo usermod -aG docker deploy
sudo install -d -o deploy -g deploy /opt/Multiplayer-Mod
```

`docker` 用户组实际拥有接近 root 的主机控制能力，因此这个账号只能用于部署，不应与普通登录账号共用。创建账号后重新登录一次，使组成员关系生效。

需要配置两套不同的 SSH 密钥：

1. **Actions → 服务器：**将登录公钥写入服务器 `deploy` 用户的 `~/.ssh/authorized_keys`，私钥保存为 GitHub `production` Environment Secret `DEPLOY_SSH_PRIVATE_KEY`。
2. **服务器 → 私有 GitHub 仓库：**在服务器上为 `deploy` 用户生成另一把密钥，把公钥添加到 `Sakura-QoQ/Multiplayer-Mod-Dev` 的只读 Deploy Key，并在该用户的 SSH 配置中让 `github.com` 使用这把密钥。不要给它写权限。

服务器侧仓库密钥可以这样生成：

```bash
sudo -iu deploy
install -d -m 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/github_multiplayer_mod -N ''
cat ~/.ssh/github_multiplayer_mod.pub
```

把输出公钥添加到私有仓库的 **Settings → Deploy keys** 后，为该用户配置 `github.com` 使用此密钥，并将 GitHub 官方公布、已核验指纹的 host key 写入 `~/.ssh/known_hosts`。最后用下面的只读命令确认仓库访问：

```bash
git ls-remote git@github.com:Sakura-QoQ/Multiplayer-Mod-Dev.git HEAD
```

在 GitHub 仓库的 `production` Environment 中设置：

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `DEPLOY_SSH_HOST` | Secret | Ubuntu 服务器域名或 IP |
| `DEPLOY_SSH_USER` | Secret | `deploy` |
| `DEPLOY_SSH_PRIVATE_KEY` | Secret | Actions 登录服务器所用的私钥全文 |
| `DEPLOY_SSH_KNOWN_HOSTS` | Secret | 已核验指纹的服务器 SSH host-key 行 |
| `DEPLOY_SSH_PORT` | Variable，可选 | SSH 端口，默认 `22` |

首次自动部署会克隆仓库，然后因为缺少私密配置而安全停止。此时在服务器创建 `/opt/Multiplayer-Mod/server/.env`：

```bash
sudo -u deploy cp /opt/Multiplayer-Mod/server/.env.example /opt/Multiplayer-Mod/server/.env
sudo -u deploy nano /opt/Multiplayer-Mod/server/.env
```

配置完成后，在 Actions 页面重新运行 `Deploy Room Server`。`.env` 已被 Git 忽略，后续的强制源码同步和 `git clean -fd` 都不会删除它。部署用户不应在 `/opt/Multiplayer-Mod` 中保存其他未跟踪文件。

建议为 GitHub 的 `production` Environment 启用仅允许 `main` 部署；如果需要人工确认，再增加 required reviewers。Actions 密钥应只允许登录 `deploy` 用户，服务器仓库 Deploy Key 应保持只读。

## 配置

公网兼容版本统一写在 `server/version.json`：`serverVersion` 标识房间服务器自身版本，`requiredModVersion` 是公开房间准入所要求的玩家 Mod 精确版本。该文件会嵌入服务器程序，与 `mod/info.json` 完全独立；修改它会触发服务器自动部署。

| 变量 | 默认值 | 范围/作用 |
| --- | --- | --- |
| `FF_ROOM_PORT` | `27777` | TCP 端口，1–65535 |
| `FF_ROOM_MAX_ROOMS` | `256` | 内存房间上限，1–10,000 |
| `FF_ROOM_MAX_PLAYERS` | `8` | 每房间玩家数，2–32 |
| `FF_ROOM_CLIENT_TIMEOUT_SECONDS` | `300` | 连续多少秒没有收到完整 TCP 帧后断开，3–3,600 |
| `FF_ROOM_AFK_TIMEOUT_SECONDS` | `300` | 连续多少秒没有有效位置移动或切换场景后断开，3–3,600 |
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

服务器启动时建立一个真实公开房间。`room.list` 只返回服务器实际管理的房间及实时人数/容量。全部房间达到 `FF_ROOM_MAX_PLAYERS` 后，服务器自动建立下一个编号房间，并回收多余空房间。`room.enter` 无密码加入列表中的房间，且不接受客户端指定容量。公开玩家取得最小空闲正数 ID 和 `authorityPeerId: 0`；已释放 ID 会复用，第一名玩家也不是权威玩家。

客户端不单独发送心跳，服务器收到现有游戏/控制数据的任何完整帧都会刷新连接活动时间。默认连续 5 分钟没有收到数据时，服务器会关闭失联套接字；连接处理器随后执行与正常退出相同的 `LeaveRoomAsync` 清理、广播 `room.playerLeft` 并释放成员 ID。

挂机计时与 TCP 活动分开。持续发送相同坐标的数据包不能无限占位：默认连续 5 分钟没有累计至少 0.05 单位的世界坐标位移、也没有切换场景时，服务器会通过同一清理路径关闭连接。

公开房间中，服务器解析控制包类型，用认证连接覆盖玩家声明的 ID/名称，只协调场景与睡眠。服务器丢弃旧版详细时钟包，永远不计算或广播 `day`、`timeOfDay`、`timeOffset`；每个游戏继续按原版统一流速推进，因此课程等剧情的 `AddTime/AddDay` 不会再被撤销。单人房间可立即批准睡眠，所有当前客户端收到批准后执行相同的时间跳转。资料内容仍由客户端管理。常驻 `public-1` 在所有玩家离开后仍显示，只回收非常驻的多余空分片。

显式 `room.create`/`room.join` 房间为协议兼容保留创建者权威；创建者离开时房间关闭。

## 容器边界

运行镜像使用 Ubuntu Chiseled .NET 8、非 root 用户、移除全部 Linux capabilities、只读根文件系统和 `no-new-privileges`。房间状态只在内存中；替换或重启容器会重置房间和名单。

## 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `Restarting (1)` | 环境变量无效 | 查看日志，检查人数 2–32 和令牌长度 |
| TCP 测试失败 | 云防火墙、UFW 或 Compose 端口 | 开放 TCP，确认 `0.0.0.0:27777->27777/tcp` |
| `unknown command` | 旧服务器镜像 | 拉取匹配源码并重新构建，必要时禁用缓存 |
| 公开房间已满 | 达到容量 | 选择其他房间，或提高 `FF_ROOM_MAX_PLAYERS` 后重启 |
| 断线玩家暂时仍在名单 | 尚未达到 TCP 空闲超时 | 最多等待 `FF_ROOM_CLIENT_TIMEOUT_SECONDS`（默认 300 秒），服务器会自动释放成员和 ID |
| 静止玩家被移除 | 已达到挂机超时 | 在 `FF_ROOM_AFK_TIMEOUT_SECONDS` 到期前移动至少 0.05 世界单位或切换场景 |
| `dubious ownership` 或 `.env` 无权限 | 仓库所有权混乱 | 让一个部署用户统一拥有 `/opt/Multiplayer-Mod` |
| 可以连接但行为不一致 | 版本不匹配 | 统一服务器、Mod 和游戏版本 |
