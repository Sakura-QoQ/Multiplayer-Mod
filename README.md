# PlayerHostedMultiplayer

Player-hosted multiplayer for **Fallen Flower**. One player's Windows PC hosts the room and runs the bundled network bridge; no central server or separate runtime installation is required.

[简体中文说明](README.zh-CN.md) · [Verification report](VERIFICATION.md) · [License](LICENSE)

## Features

- Native-style multiplayer entry on the main menu and multiplayer settings in the pause menu.
- Host or join directly from the in-game UI. The pause menu remains visible without stopping online world time.
- Up to four players by default; the host acts as the authoritative relay.
- Player model, position, rotation, movement, grounded state, weapon, action and all Animator layers are synchronized.
- Clothing, skin tan, character customization, complete save-profile data and continuously changing player status are synchronized.
- Remote transforms and clothing bones are updated every render frame from 5 Hz network snapshots.
- The host controls world time, date and time-of-day. Sleeping advances time only after every connected player agrees on the same sleep mode.
- Online saves use one persistent UUIDv7 per player and never appear in the single-player load/save UI.
- Exiting online mode saves and verifies the online file before quitting.

## Installation

1. Import `PlayerHostedMultiplayer-v0.9.0-win-x64.zip` with the game's dedicated Mod launcher.
2. Start the game through that Mod launcher.
3. Select **Multiplayer** above **New Game** on the main menu.

The package contains a Windows x64 NativeAOT bridge and all of its runtime dependencies. Players do **not** need Node.js, TypeScript, .NET, Visual Studio or a separate start script.

## Hosting and joining

- **Host:** choose a player name, port and maximum player count, then select **Host and Enter**. The Mod resumes that player's UUIDv7 online save, or creates the first online save from a clean game when none exists.
- **Join:** enter the host address and port, then select **Join**. Every player keeps an independent online save and personal progress.
- **LAN:** use the host PC's LAN IPv4 address, for example `192.168.1.20`.
- **Internet:** the host must allow the configured TCP port through Windows Firewall and usually forward it on the router, or use a trusted virtual-LAN tool.

All players should use the same game and Mod versions. The default TCP port is `27777`.

## Architecture

```text
PlayerHostedMultiplayer
├─ mod
│  ├─ main.ts                         In-game UI, hooks, synchronization and saves
│  ├─ config.json                     Default configuration
│  ├─ README.txt                      Default English player guide
│  ├─ README.zh-CN.txt                Simplified Chinese player guide
│  └─ i18n/<language>/strings.json    In-game localization
├─ src
│  ├─ MultiplayerBridge               Framed TCP networking core
│  ├─ MultiplayerBridgeHost           NativeAOT bridge, IPC and save protection
│  └─ MultiplayerBridge.SmokeTest      Network smoke test
├─ tests
│  ├─ dual-instance                   Two real game-process integration test
│  └─ online-save                     Online-save lifecycle integration test
└─ build.ps1                          Build, package and optional local install
```

`main.ts` runs inside the Mod launcher's Jint environment. It communicates with the bundled bridge through bounded commands and atomic state snapshots. TCP messages use a four-byte big-endian length prefix followed by UTF-8 JSON, with size and queue limits.

## Synchronization model

- Player state and authoritative world time are sent at 5 Hz to limit bandwidth.
- Rendering still runs every frame: remote positions, rotations, animation layers and clothing bones interpolate toward the newest snapshot.
- Complete `GetSave()` profile data is chunked when necessary, reassembled with revision tracking and retained per remote player.
- Frequently changing health, stamina, money, time and scene values use a smaller live-data message.
- Remote avatars are visual-only clones. Input, camera, collision and gameplay scripts are removed before activation.

The game save contains photo metadata but not the external PNG image bytes; those external image files are not transferred.

## Online-save isolation

- Formal file: `MPOnline_<player UUIDv7>.save`.
- Recovery working copy: `MPActive_<player UUIDv7>.save`.
- Both are filtered from the original single-player load/save pages.
- The inner layer matches the game's `Encrypted` format: PBKDF2-SHA256, AES-256-CBC and HMAC-SHA256.
- The outer Mod layer uses PBKDF2-SHA256 and AES-256-GCM authenticated encryption.
- Save writes are atomic. The working copy remains available for recovery, and the original `AutoSave*.save` files are not overwritten.

## Build and verification

Development requires the .NET 8 SDK and Visual Studio x64 C++ tools for NativeAOT linking:

```powershell
./build.ps1 -Install
dotnet run --project ./src/MultiplayerBridge.SmokeTest -c Release
./tests/online-save/Run-OnlineSaveLifecycleTest.ps1
./tests/dual-instance/Run-DualInstanceTest.ps1 -Address <LAN IPv4>
```

The integration tests create temporary lightweight game instances and are not included in the player package. See [VERIFICATION.md](VERIFICATION.md) for the verified scope and evidence paths.

## Supported environment

- Windows x64
- Fallen Flower with the dedicated Mod launcher
- Matching game and Mod versions for every participant

## License

This is proprietary, non-public-source software. Personal use of an authorized binary copy is permitted; source disclosure, redistribution, modification and commercial use require prior written permission. See [LICENSE](LICENSE).
