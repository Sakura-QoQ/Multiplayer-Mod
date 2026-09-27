# 游戏 Mod 源码结构

本目录是游戏内 Mod 的可编辑源码。UcModLauncher 只加载一个脚本入口，不能解析 TypeScript
模块，因此 `build.ps1` 会按照 `source-order.json` 将这些文件合并为 `mod/main.ts`。不要直接
修改生成文件。

- `core/`：共享协议类型、常量、状态和通用运行时工具。
- `network/bridge/`：IPC 状态快照及随包桥接进程通信。
- `network/control/`：建房、加入和主网络更新循环。
- `network/events/`：入站消息分发。
- `network/`：配置、消息传输、校验和房主权威时间。
- `player/avatar/`：远端模型、材质、衣服和骨骼映射。
- `player/info/`：玩家信息展示模型。
- `player/profile/`：玩家资料读取、存储和分片传递。
- `player/state/`：高频坐标/动作快照和远端模型逐帧渲染。
- `save/`：线上存档进入、重定向、保护和退出保存。
- `ui/components/`：可复用的 Unity UI 组件，页面通过这些组件创建控件。
- `ui/pages/`：联机面板、主菜单入口和暂停菜单页面。
- `ui/i18n/<语言缩写>/strings.json`：界面语言包。
- `hooks/`：唯一负责注册游戏 Hook 和启动入口的目录。
- `diagnostics/`：双实例自动验证逻辑，默认通道不会启用。

新增模块时，需要把它加入 `source-order.json`，并放在其依赖声明之后。构建时语言包会复制
到运行目录 `mod/i18n`。
