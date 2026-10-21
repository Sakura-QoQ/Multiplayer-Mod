# Fallen Flower Multiplayer

公开房间与本地直连联机 Mod。当前客户端 v1.1.13，TypeScript 服务端 v1.2.0。

## 玩家安装

用游戏 Mod 启动器导入 `artifacts/Multiplayer-v1.1.13-win-x64.zip`，启动后选择“联机”。安装包包含 Windows x64 桥，无需另装 Node.js 或 .NET。旧 PlayerHostedMultiplayer 入口应禁用，避免重复加载。

房间统一日期、四个时段、场景和全员睡眠；原版详细时钟流速与个人存档保持本地。更晚的存档会推进房间日期，较早者通过原版接口追赶，可能使个人限时任务过期。版本差异仅提示，不阻止加入；共享日历需要成员统一更新 Mod。

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

GitHub Actions 构建可独立运行的 dist 目录，改名为 FallenFlowerServer 后部署至 `/opt/FallenFlowerServer/`，通过 `systemctl` 管理。主机配置保存在 `/opt/FallenFlowerServer/.env`。[首次安装和部署](server/README.zh-CN.md)。

[测试状态](docs/VERIFICATION.md) · [许可证](docs/LICENSE)
