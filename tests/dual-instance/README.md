# 双游戏实例验证

`Run-DualInstanceTest.ps1` 是开发验证工具，不进入玩家发布包。它使用硬链接和只读目录联接创建两份轻量游戏实例，分别加载 `host`、`client` 测试通道，并保存独立日志与 JSON 证据。

验证范围：

- 两个真实 `FallenFlower.exe` 进程；
- 两个隔离的桥接进程和本机 TCP 会话；
- 双方进入相同存档/场景；
- 双方创建远端人物模型；
- 双方接收衣服、外观和完整存档资料包；
- 远端位置与动作包进入 Animator 映射；
- 测试前后 `AutoSave*.save` 哈希不变。

测试通道使用 `--network-only`，不会执行线上存档封装或 AutoSave 重定向。生产配置始终为 `bridgeChannel=default`，不启用该测试路径。

默认使用 `127.0.0.1`。要验证房主监听能通过真实局域网网卡访问，可指定房主当前 IPv4：

```powershell
./Run-DualInstanceTest.ps1 -Address 192.168.37.127
```

真实发送 ESC 并截图验证联机暂停菜单（不启动客户端）：

```powershell
./Run-DualInstanceTest.ps1 -CapturePauseUiOnly
```
