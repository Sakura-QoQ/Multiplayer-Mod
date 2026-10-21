# Fallen Flower Multiplayer

公开房间联机与线上存档实验 Mod。当前客户端 v1.2.3，TypeScript 服务端 v1.2.0。

## 玩家安装

用游戏 Mod 启动器导入 `artifacts/Multiplayer-v1.2.3-win-x64.zip`，然后直接从游戏 Mod 启动器启动游戏。游戏启动后选择“联机”，登录或注册后选择房间。安装包包含自包含 Windows x64 线上启动器和网络桥，无需另装 Python、Frida、Node.js 或 .NET。旧 PlayerHostedMultiplayer 入口应禁用，避免重复加载。六种界面语言随游戏切换；登录页支持受 Windows 凭据管理器保护的记住账号、自动填充和自动登录，并可随时清除。

角色从服务器数据库加载，不导入本机旧存档；账号和存档通过 HTTPS 访问 `13.40.7.1:27777`，与原房间 TCP 共用端口。点击游戏内“联机”会自动在后台启动随包线上组件并连接到当前游戏，不再需要单独运行脚本，也不会另开一个游戏。

当前为实验玩家包：照片恢复、复杂剧情与双游戏实例可玩性尚未完整验收。房间仍采用旧的共享绝对日期/时段规则，尚未完成“共享时段、个人天数独立”；日历追赶可能影响限时剧情。详见[实验说明](docs/ONLINE_STORAGE.md)。

## 开发与部署

- `mod/`：客户端源码、Windows 桥和构建工具。
- `server/`：独立 TypeScript/Node.js 服务端，无 .NET 或 Docker 依赖。
- `artifacts/`：生成的客户端桥、打包暂存与安装 ZIP，不是源码。详见[目录说明](docs/DEVELOPMENT.md)。
- `docs/`：[当前文档索引](docs/README.md)。

本地开发需要 Node.js >=22.18；GitHub 编译的 Linux x64 服务端程序无需安装 Node.js 或 npm：

```bash
cd server
npm ci
npm run build
npm start
```

GitHub Actions 编译 `dist/FallenFlowerServer` Linux x64 可执行程序，将 dist 目录改名为 FallenFlowerServer 后部署至 `/opt/FallenFlowerServer/`，通过 `systemctl` 管理。主机配置保存在 `/opt/FallenFlowerServer/.env`。[首次安装和部署](server/README.zh-CN.md)。

[测试状态](docs/VERIFICATION.md) · [许可证](docs/LICENSE)
