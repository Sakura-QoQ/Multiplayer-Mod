# 开发与构建

## 项目目录

| 目录                                             | 用途                                                 |
| ------------------------------------------------ | ---------------------------------------------------- |
| server/src                                       | TypeScript 房间服务器                                |
| server/tests、server/tools                       | 服务端测试、构建及部署工具                           |
| mod/src/GameMod                                  | 游戏 Jint 脚本源码                                   |
| mod/src/MultiplayerBridge、MultiplayerBridgeHost | 客户端网络桥与 Windows 进程宿主                      |
| mod/src/MultiplayerBridge.SmokeTest、mod/tools   | 客户端测试和构建工具                                 |
| artifacts                                        | 本地生成的客户端桥接程序、打包暂存目录和当前安装 ZIP |

`artifacts/bridge/win-x64/` 供构建脚本复用；`artifacts/package/` 是打包暂存；`artifacts/Multiplayer-v1.1.13-win-x64.zip` 供玩家安装。均可重新构建。删除 bridge 后需要完整 Windows 工具链才能重建，不能再使用 SkipBridgeBuild。服务器发布物位于 `server/dist/`，不使用 artifacts 部署。

## 服务器

需要 Node.js >=22.18、npm。

```bash
cd server
npm ci
npm test
npm run test:release
npm run build:release # Linux x64 / WSL / GitHub Actions
npm run test:executable
```

`npm run build` 编译开发用 JS；Linux x64 上的 `npm run build:release` 使用 esbuild 和 Node.js SEA 输出 dist/FallenFlowerServer 单文件程序及许可证。两种输出使用同一 dist 目录，发布构建会清理开发用 JS。GitHub Actions 编译、隔离测试后上传，目标机不需要 Node.js、npm、TypeScript 或 .NET。

[运行和部署](../server/README.zh-CN.md)

## 客户端

Windows 完整构建需要 .NET 8 SDK 和 Visual Studio x64 C++ NativeAOT 工具。玩家只需要安装包与游戏 Mod 启动器，无需安装 Node 或 .NET。

```powershell
./mod/tools/Build-Mod.ps1 -Install
```

仅修改游戏脚本且已有当前桥接产物时，可跳过编译。构建脚本核对桥接源码指纹，源码变化或缺少构建记录时会拒绝复用，必须先执行完整构建：

```powershell
./mod/tools/Build-Mod.ps1 -Install -SkipBridgeBuild
```

编辑 mod/src/GameMod，新增脚本需加入 source-order.json。构建脚本合并生成 mod/main.ts，并复制语言包和素材；不要手改生成文件。Jint 不解析 Node import，客户端游戏脚本不能直接使用 npm 网络库。

## 格式与测试

两端有独立 package.json 和锁文件，npm 仅用于开发。EditorConfig/Git 属性统一 UTF-8、LF 与空格；Prettier 跳过生成文件。

```bash
npm --prefix server ci
npm --prefix server run format:check
npm --prefix server test
npm --prefix mod ci
npm --prefix mod run format:check
npm --prefix mod test
```

把 format:check 改为 format 可写入格式。C# 使用 `dotnet format whitespace PROJECT.csproj --no-restore`，加 `--verify-no-changes` 仅检查。

存档必须沿用游戏原版 AutoSave。进入房间调用 LoadSaveWindow.ExecuteLoad；不要重新引入 MPOnline/MPActive 磁盘重定向、全存档广播或拦截原版 AddDay/SetTime 事务。
