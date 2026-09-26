PlayerHostedMultiplayer v0.4.0（Windows x64 开发预览版）

安装：
1. 把整个 PlayerHostedMultiplayer 文件夹放进游戏的 Mods 目录。
2. 运行 Install-PlayerHostedMultiplayer.cmd 一次。
3. 以后使用游戏根目录的“启动联机 Mod.cmd”启动。
4. 在主菜单“新建游戏”按钮正上方点击“联机”。

界面会跟随游戏语言菜单自动切换。语言包位于 i18n 目录：
en、ja、zh-CN、zh-TW、ko、es；每种语言都有独立的 strings.json。

本版本不再把 version.dll 放进游戏根目录，不修改游戏文件，也不绕过游戏反篡改。
网络桥 MultiplayerBridgeHost.exe、.NET 运行时和全部依赖已编译进 Mod 包；玩家不需要安装
Visual Studio、.NET、Node.js、TypeScript 或其他开发软件。

“建立主机”会让当前玩家电脑监听设置的 TCP 端口。互联网玩家仍需要房主在路由器或
防火墙中允许该端口；同一局域网通常直接填写房主的局域网 IP 即可。

v0.4.0 会同步同场景玩家的模型、位置、朝向和 Animator 动作。远端模型使用安全的
可视层克隆，不会复制本地输入、相机、碰撞或游戏逻辑。状态以 5 Hz 发送并逐帧平滑显示。

存档读取调用游戏自己的 GameManager.GetSave()。明文快照只保存在当前游戏进程内存中，
不会自动上传、覆盖或写回存档文件。
“选择存档”会显示本机存档列表；桥接程序只读取文件名、大小和修改时间等元数据。
