# Online-save lifecycle integration test

[简体中文](README.zh-CN.md)

`Run-OnlineSaveLifecycleTest.ps1` starts the real game twice with one randomly generated UUIDv7 online-save name.

The first run creates the online save, moves the player and exits through the Mod's verified save path. The second run opens the same UUID, checks the restored position and exits again.

The test also verifies the `MPB2` outer encryption marker, retained `MPActive_` recovery copy, unchanged single-player `AutoSave*.save` hashes, bridge shutdown and TCP port release. Test-only save files are removed in `finally` unless diagnostic retention is explicitly requested.

```powershell
./Run-OnlineSaveLifecycleTest.ps1 -Port 28860 -TimeoutSeconds 180
```
