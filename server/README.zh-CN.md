# 服务器构建与部署

服务端使用 TypeScript/Node.js，管理房间、场景、睡眠和日期/时段；不运行 Unity、不读取玩家存档。需要 Node.js >=22.18 与 npm。

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

1. GitHub Ubuntu runner 安装依赖、检查格式并运行测试。
2. 执行 `npm run build:release`，生成完整的 dist 目录，包含编译 JS、version.json、运行 package.json、锁文件、许可证和生产 node_modules。源码与开发依赖不上传。
3. 启动 dist 中的服务进行真实 TCP ping/pong 检查。
4. 将 dist 改名为 FallenFlowerServer，再 SCP 上传到 `/opt/FallenFlowerServer/.incoming-提交号/` 暂存。
5. 首次上传会先将文件放到主目录；若缺少 .env 或服务配置，日志提示手动配置并以失败状态结束，不会误报服务已运行。正常更新由 tools/deploy.sh 停服、更新主目录文件、重启并检查健康。
6. 重启或健康检查失败则恢复上一 dist；成功后删除临时旧版和上传暂存，只保留当前版本。

服务器不运行编译、npm install、Docker 或 Git 拉取。SSH 中断或磁盘错误若遗留 `.previous-runtime`，脚本会拒绝覆盖它；管理员需先核实并恢复该目录，再重新部署。

最终布局：

```text
/opt/FallenFlowerServer/
├── .env
├── index.js
├── health.js
├── version.json
├── package.json
├── package-lock.json
├── node_modules/
├── COMMIT
└── 其他编译模块及许可证
```

## 首次配置服务器

先安装 Node.js >=22.18、npm、systemd，确认 `/usr/bin/npm` 可用。手动创建 `/opt/FallenFlowerServer/` 并授予部署账号写权限，工作流不会创建根目录。触发部署后，首次上传的 index.js、package.json 和 node_modules 会放到该目录；首次缺少配置时 Actions 会提示尚未完成启动。

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
Environment=NPM_CONFIG_CACHE=/tmp/fallen-flower-npm
Environment=NPM_CONFIG_UPDATE_NOTIFIER=false
ExecStart=/usr/bin/npm --silent start
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
node /opt/FallenFlowerServer/health.js --env-file /opt/FallenFlowerServer/.env
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

.env 使用环境变量赋值，不写 shell 命令或 export。配置不随部署覆盖。版本由 version.json 管理，当前 server v1.2.0 对应 Mod v1.1.13。

所有房间和日历只在内存中，重启会断开玩家并清空房间状态。共享日期通过原版 AddDay/SetTime 推进，可能使个人限时任务过期；详细钟点流速与个人剧情保留本地。传输仍是明文 TCP。
