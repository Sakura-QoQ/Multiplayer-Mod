# Fallen Flower Multiplayer 1.0.0

Dedicated-room multiplayer Mod for **Fallen Flower**, with public rooms, local direct play, synchronized avatars and the game's native save workflow.

[简体中文](docs/PROJECT.zh-CN.md) · [Documentation](docs/README.md) · [Protocol / 错误码](docs/PROTOCOL.zh-CN.md) · [Security](docs/SECURITY.md) · [Verification](docs/VERIFICATION.md) · [License](docs/LICENSE)

## Install

1. Import `artifacts/PlayerHostedMultiplayer-v1.0.0-win-x64.zip` with the game's Mod launcher.
2. Start the game through the launcher and select **Multiplayer**.
3. Enter a display name, open **Public servers**, and enter a listed room.

The package includes a self-contained Windows x64 bridge. It does not require Node.js, the .NET runtime, Visual Studio, an installer, elevation, or registry changes. Diagnostics are written to `Mods/PlayerHostedMultiplayer/Logs/PlayerHostedMultiplayer.log` with bounded rotation.

## 1.0 behavior

- `public-1` is permanent. Additional rooms are created only when all joinable rooms are full; redundant empty rooms are reclaimed.
- The server is logical peer `0`. Players receive positive IDs and cannot impersonate server control packets or other players.
- The server coordinates membership, scenes and unanimous sleep only. It never owns or writes detailed game time; every client keeps the game's default time speed and native story transactions.
- A one-player room needs only that real player to approve sleep. The server itself is never counted as a player.
- Joining loads native `AutoSave` directly through the original `LoadSaveWindow.Load` path without clicking or displaying the save picker. Autosave, bed save, pause-menu save and quit continue to use the original game slot.
- The bridge never creates, reads, redirects, encrypts or promotes `MPOnline`/`MPActive`. Legacy files are left untouched for manual recovery.
- Only remote-display data is sent: appearance, live state and aggregate progress counts. Full save/story/contact data is never broadcast or stored by the room server.
- The phone is bounded to 80% of the screen height and includes Home, Messages and online Contacts pages.

Public transport is length-prefixed JSON over plain TCP, not TLS. The embedded endpoint is obfuscated only to prevent casual editing and is not a security boundary.

## Build

```powershell
./tools/Build-Mod.ps1 -Install
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-runtime-log
```

Server deployment is documented in [server/README.md](server/README.md); no server ZIP is produced. Development details are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
