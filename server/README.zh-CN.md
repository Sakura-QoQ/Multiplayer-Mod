# 服务器构建与部署

服务端使用 TypeScript/Node.js，管理房间、场景、睡眠和日期/时段；不运行 Unity、不读取玩家存档。本地开发需要 Node.js >=22.18 与 npm；生产发布为 Linux x64 单文件程序，运行服务器无需安装 Node.js、npm 或 .NET。

## 源码职责

```text
src/
├── api/          # 接口、路由、请求/响应格式和校验
├── middleware/   # 错误处理、请求解析、限流、管理鉴权
├── services/     # 房间业务与同步裁决
├── server.ts     # TCP 服务生命周期
├── connection.ts # TCP 帧收发与背压
├── protocol.ts   # 帧编码与 JSON 深度限制
├── room.ts       # 单房间状态
└── security.ts   # 共享的常量时间密钥比较
```

[API 格式和扩展方式](../docs/PROTOCOL.md)

## 本地开发

在 server/ 执行：

```bash
npm ci
npm test
npm run build
npm start
npm run check:health
```

复制 .env.example 为 .env 设置本地配置。CLI 参数优先于环境变量；`npm start -- --help` 查看选项。Zod 校验输入，Commander 解析 CLI，Pino 输出结构化日志；传输保留现有的 4 字节大端长度 + JSON TCP 协议。

## GitHub Actions 部署

main 的服务端或工作流变化触发 `.github/workflows/deploy-server.yml`，也可手动触发。流程为：

1. GitHub Ubuntu 22.04 x64 runner 使用固定版本 Node.js 22.23.3，安装依赖、检查格式并运行测试。
2. 执行 `npm run build:release`，用 esbuild 打包代码和运行依赖，再用 Node.js SEA 封装成 dist/FallenFlowerServer。版本信息嵌入程序，dist 仅保留程序和许可证。源码、JS 和 node_modules 不上传。
3. 仅复制可执行文件到隔离目录，在 PATH 无 Node/npm 的条件下检查启动、TCP ping/pong 和 SIGTERM 退出；再检查部署回滚。
4. 将 dist 改名为 FallenFlowerServer，再 SCP 上传到 `/opt/FallenFlowerServer/.incoming-提交号/` 暂存。
5. 首次上传会先将文件放到主目录；若缺少 .env 或服务配置，日志提示手动配置并以失败状态结束，不会误报服务已运行。正常更新由 tools/deploy.sh 停服、更新主目录文件、重启并检查健康。
6. 重启或健康检查失败则恢复上一 dist；成功后删除临时旧版和上传暂存，只保留当前版本。

服务器不运行编译、npm install、Docker 或 Git 拉取。SSH 中断或磁盘错误若遗留 `.previous-runtime`，脚本会拒绝覆盖它；管理员需先核实并恢复该目录，再重新部署。

最终布局：

```text
/opt/FallenFlowerServer/
├── .env
├── FallenFlowerServer  # Linux x64 可执行文件
├── COMMIT
├── LICENSE
├── LICENSE.zh-CN
├── THIRD_PARTY_NOTICES.txt
└── NODE_LICENSE.txt
```

## 首次配置服务器

目标机使用 Linux x64（glibc >=2.28，Ubuntu 20.04 及以上），需要 systemd，无需 Node.js 或 npm。手动创建 `/opt/FallenFlowerServer/` 并授予部署账号写权限，工作流不会创建根目录。首次缺少 .env 或 unit 时，程序仍上传到主目录，但 Actions 会提示尚未完成启动。

已有 npm 启动的 unit 需手动改成 `ExecStart=/opt/FallenFlowerServer/FallenFlowerServer`，然后执行 `sudo systemctl daemon-reload`，再触发部署。部署脚本会在停止现有服务之前检查启动路径；常规更新会删除旧 JS、package.json 和 node_modules。迁移失败时旧文件可恢复，但恢复旧版 npm 服务需把 unit 的 ExecStart 一并改回。

以下示例按当前登录账号 ubuntu 手动创建服务，不随发布包携带 unit。若部署使用其他账号，同时调整 User、Group 和 sudoers。

```bash
cd /opt/FallenFlowerServer
touch .env
chmod 600 .env
sudo tee /etc/systemd/system/fallen-flower-room.service >/dev/null <<'EOF'
[Unit]
Description=Fallen Flower room server
After=network.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/opt/FallenFlowerServer
EnvironmentFile=/opt/FallenFlowerServer/.env
Environment=NODE_ENV=production
ExecStart=/opt/FallenFlowerServer/FallenFlowerServer
Restart=on-failure
RestartSec=3
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now fallen-flower-room.service
sudo systemctl status fallen-flower-room.service
```

空 .env 使用默认 TCP 27777 和其他默认配置；已有 .env 不会被 touch 覆盖。配置变量见下表。若启动失败，用 `sudo journalctl -u fallen-flower-room.service -n 80 --no-pager` 查看原因。

Actions 账号必须能非交互执行所需 systemctl 命令。已有合适 sudo 权限时无需新增规则；否则管理员通过 `sudo visudo -f /etc/sudoers.d/fallen-flower-room-deploy` 添加精确授权，例如：

```sudoers
ubuntu ALL=(root) NOPASSWD: /usr/bin/systemctl cat fallen-flower-room.service, /usr/bin/systemctl restart fallen-flower-room.service, /usr/bin/systemctl stop fallen-flower-room.service, /usr/bin/systemctl is-active --quiet fallen-flower-room.service
```

为部署账号配置 Actions 登录公钥。GitHub production Environment 设置：

| 名称                   | 类型     | 用途                     |
| ---------------------- | -------- | ------------------------ |
| DEPLOY_SSH_HOST        | Secret   | 主机地址                 |
| DEPLOY_SSH_USER        | Secret   | 实际部署账号，如 ubuntu  |
| DEPLOY_SSH_PRIVATE_KEY | Secret   | 登录私钥                 |
| DEPLOY_SSH_KNOWN_HOSTS | Secret   | 已核验的 SSH host-key 行 |
| DEPLOY_SSH_PORT        | Variable | SSH 端口，默认 22        |

首次从旧目录迁移时，将原配置内容迁入 `/opt/FallenFlowerServer/.env`，重新安装当前 unit 并 daemon-reload；在新 dist 上传前不要启动新 unit。旧服务器目录不会被本流程自动删除。触发 Actions 后，它会启动新服务。需要手动控制时：

```bash
sudo systemctl start fallen-flower-room.service
sudo systemctl restart fallen-flower-room.service
sudo systemctl status fallen-flower-room.service
sudo journalctl -u fallen-flower-room.service -n 100 --no-pager
/opt/FallenFlowerServer/FallenFlowerServer --check-health --env-file /opt/FallenFlowerServer/.env
```

开放云安全组和主机防火墙的房间 TCP 端口。修改 unit 后需重新安装并 daemon-reload；常规代码更新不改 unit 或 .env。

## 配置

| 变量                           | 默认值  | 范围                           |
| ------------------------------ | ------- | ------------------------------ |
| FF_ROOM_LISTEN                 | 0.0.0.0 | IPv4/IPv6 地址                 |
| FF_ROOM_PORT                   | 27777   | 1–65535                        |
| FF_ROOM_MAX_ROOMS              | 256     | 1–10000                        |
| FF_ROOM_MAX_PLAYERS            | 8       | 2–32                           |
| FF_ROOM_CLIENT_TIMEOUT_SECONDS | 300     | 3–3600                         |
| FF_ROOM_AFK_TIMEOUT_SECONDS    | 300     | 3–3600                         |
| FF_ROOM_ADMIN_TOKEN            | 空      | 空值关闭管理，否则 16–256 字符 |

.env 使用环境变量赋值，不写 shell 命令或 export。只有 .env 不随部署覆盖；config/database.json 随每次部署更新并参与失败回退。版本由 version.json 管理，当前 server v1.2.0 对应 Mod v1.1.13。

所有房间和日历只在内存中，重启会断开玩家并清空房间状态。共享日期通过原版 AddDay/SetTime 推进，可能使个人限时任务过期；详细钟点流速与个人剧情保留本地。传输仍是明文 TCP。

## PostgreSQL storage experiment

[Local WSL setup, JWT API and diskless client experiment](../docs/ONLINE_STORAGE.md). The complete config/database.json is tracked and automatically deployed with the executable; no database configuration Secrets are used. The managed config directory is replaced and rolled back with the runtime (directory 700, file 600), while .env is preserved. Database initialization requires an explicit --migrate; ordinary startup/build/deployment never migrates tables.

数据库配置直接修改 server/config/database.json。GitHub 构建后验证并复制到发布目录，部署目标为 /opt/FallenFlowerServer/config/database.json。不要在 .env 中把 FF_DATABASE_CONFIG 指向其他路径，否则进程会使用另一份配置。仓库可读者能够看到该文件的连接凭据；客户端包和公开文档同步清单不包含此文件。
