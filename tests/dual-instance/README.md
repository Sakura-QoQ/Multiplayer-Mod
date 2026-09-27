# Two-game-instance integration test

[简体中文](README.zh-CN.md)

`Run-DualInstanceTest.ps1` is a development-only integration test and is not included in the player release. It creates two lightweight game directories with hard links and read-only junctions, then starts separate `host` and `client` Mod channels.

The test verifies:

- two real `FallenFlower.exe` processes;
- two isolated bridge processes and a real TCP connection;
- protocol negotiation and peer assignment;
- remote player creation on both sides;
- complete profile chunks, live player status, clothing, skin tan and bone rebinding;
- movement, actions, Animator layers and host-authoritative scene following;
- online pause/phone behavior, world-time synchronization and unanimous sleep approval;
- unchanged hashes for the original `AutoSave*.save` files;
- natural process exit and released test ports.

The non-default test channels use `--network-only`, so they cannot write production online saves. Normal players always use the `default` channel.

Use the host PC's active LAN IPv4 to exercise a physical network adapter instead of loopback:

```powershell
./Run-DualInstanceTest.ps1 -Address 192.168.37.127 -Port 28861
```

To verify only the original pause window and capture a screenshot:

```powershell
./Run-DualInstanceTest.ps1 -CapturePauseUiOnly
```
