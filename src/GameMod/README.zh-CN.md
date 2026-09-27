# 游戏 Mod 源码结构

本目录是游戏内 Mod 的可编辑源码。UcModLauncher 只加载一个脚本入口，不能解析 TypeScript
模块，因此 `build.ps1` 会按照 `source-order.json` 将这些文件合并为 `mod/main.ts`。不要直接
修改生成文件。

联机主页保留本地直连建立/加入。公开服务器入口会先通过随包桥接请求服务器实际管理的房间及
实时人数/容量，玩家再选择房间；公网端点不进入可编辑 UI 配置。公开房间容量由服务器决定，
`localMaxPlayers` 只用于本地直连房主。

- `core/`：共享协议类型、常量、状态和通用运行时工具。
- `network/bridge/`：IPC 状态快照及随包桥接进程通信。
- `network/control/`：公开房间会话、保留的传输兼容代码及主网络更新循环。
- `network/events/`：入站消息分发。
- `network/`：配置、消息传输、校验，以及服务器权威时间与场景处理。
- `player/avatar/`：远端模型、材质、衣服和骨骼映射。
- `player/info/`：玩家信息展示模型。
- `player/profile/`：玩家资料读取、存储和分片传递。
- `player/state/`：高频坐标/动作快照和远端模型逐帧渲染。
- `save/`：UUIDv7 进入、只读加载事务、临时加载副本释放、直接提交 `MPOnline` 和退出验证。
- `ui/components/`：可复用的 Unity UI 组件，页面通过这些组件创建控件。
- `ui/pages/`：本地建立/加入、公开房间浏览、暂停菜单只读房间信息页和玩家名单页面。
- `ui/i18n/<语言缩写>/strings.json`：界面语言包。
- `hooks/`：唯一负责注册游戏 Hook 和启动入口的目录。
- `diagnostics/`：双实例自动验证逻辑，默认通道不会启用。

新增模块时，需要把它加入 `source-order.json`，并放在其依赖声明之后。构建时语言包会复制
到运行目录 `mod/i18n`。

只有 `role !== "off"` 时才拦截线上 `SaveGame("AutoSave")`：取消原版磁盘写入，把内存快照
提交到 `MPOnline`。单机模式会直接离开 Hook，不进行拦截。不要重新引入桥接层的
`AutoSave.save` 监视逻辑。
