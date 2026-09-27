# 双游戏实例集成测试

[English](README.md)

`Run-DualInstanceTest.ps1` 只用于开发验证，不进入玩家发布包。它使用硬链接和只读目录联接创建两个轻量游戏目录，然后分别启动隔离的 `host` 与 `client` Mod 通道。

测试范围：

- 两个真实 `FallenFlower.exe` 进程；
- 两个隔离桥接进程和真实 TCP 连接；
- 协议握手和玩家编号；
- 双方远端人物模型创建；
- 完整资料分片、实时玩家状态、衣服、晒黑肤色和骨骼重绑；
- 移动、动作、Animator 层和房主权威跨场景跟随；
- 联机暂停/手机行为、世界时间同步和全员睡眠同意；
- 原版 `AutoSave*.save` 哈希保持不变；
- 测试进程自然退出且端口释放。

非默认测试通道使用 `--network-only`，不会写入生产线上存档。普通玩家始终使用 `default` 通道。

指定房主当前局域网 IPv4，可以验证物理网卡路径而不是回环地址：

```powershell
./Run-DualInstanceTest.ps1 -Address 192.168.37.127 -Port 28861
```

只验证原版暂停窗口并截图：

```powershell
./Run-DualInstanceTest.ps1 -CapturePauseUiOnly
```
