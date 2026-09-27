# 线上存档生命周期集成测试

[English](README.md)

`Run-OnlineSaveLifecycleTest.ps1` 会用一个随机生成的 UUIDv7 线上存档名，先后启动两次真实游戏。

第一轮创建线上档、移动角色，并通过 Mod 的验证保存流程退出。第二轮打开同一个 UUID，检查位置恢复后再次退出。

测试还会验证 `MPB2` 外层加密标记、保留的 `MPActive_` 恢复副本、单机 `AutoSave*.save` 哈希不变、桥接程序退出和 TCP 端口释放。除非明确要求保留诊断文件，否则测试专用存档会在 `finally` 中清理。

```powershell
./Run-OnlineSaveLifecycleTest.ps1 -Port 28860 -TimeoutSeconds 180
```
