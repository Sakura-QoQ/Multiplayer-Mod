# Fallen Flower Multiplayer — dedicated server edition

Public-server multiplayer for **Fallen Flower**. Every player connects to a Docker-hosted Ubuntu relay by selecting one of the built-in public-server buttons.

`PlayerHostedMultiplayer` remains the package and folder identifier for upgrade compatibility; it no longer describes the production network architecture.

> **v0.11.0 deployment requirement:** update both the player Mod and the Ubuntu room server. Earlier servers do not understand one-click public-room entry.

[简体中文说明](README.zh-CN.md) · [Documentation index](docs/README.md) · [Verification report](VERIFICATION.md) · [License](LICENSE)

## Features

- A native-style Multiplayer entry on the main menu with three one-click public-server choices; players do not enter an address, room ID or password.
- During an online session, the pause-menu entry opens a read-only room page showing role/public-room name, synchronized time, player count and player list. The world, physics, animation and online clock continue running behind it.
- Up to eight players per room by default; the server limit is configurable from 2 to 32.
- Every player connects as an ordinary participant. The Ubuntu service owns room membership, the logical authority identity, the shared clock, scene arbitration and sleep consensus; no player exposes a public port or receives host privileges.
- Hold `Tab` in an online game to show the localized room-player list in the center of the screen.
- Player model, position, rotation, movement, grounded state, weapon, action and all Animator layers are synchronized.
- Clothing, skin tan, character customization, complete save-profile data and continuously changing player status are synchronized.
- Player movement snapshots are sent at 20 Hz; remote transforms and clothing bones are still updated every render frame.
- The server advances one authoritative clock and every player continuously calibrates to it. Sleeping advances only after the server observes the same request from every connected player.
- Online saves use one persistent UUIDv7 per player and never appear in the single-player load/save UI.
- Exiting online mode saves and verifies the online file before quitting.

## Installation

1. Import `PlayerHostedMultiplayer-v0.11.0-win-x64.zip` with the game's dedicated Mod launcher.
2. Start the game through that Mod launcher.
3. Select **Multiplayer** above **New Game** on the main menu.

The package contains a Windows x64 NativeAOT bridge and all of its runtime dependencies. Players do **not** need Node.js, TypeScript, .NET, Visual Studio or a separate start script.
The bridge runs with the current user's normal token and does not request administrator elevation.
Dedicated-server players need outbound TCP access only. Windows inbound firewall and router port forwarding are not required.

## Quick start

1. Enter a player name.
2. Select **Public Server 1**, **Public Server 2** or **Public Server 3**.
3. The server atomically joins the existing public room or creates it when empty. No password is used.
4. The Mod resumes the player's own UUIDv7 online save, or creates it from a clean game only when none exists.

The endpoint is stored as an AES-GCM-encrypted constant inside the native bridge, not in `config.json`, the UI or language files. This prevents casual plaintext discovery and configuration changes, but is obfuscation rather than secret management because a client must contain the decryption material. All players must use matching game and Mod versions. A player leaving removes only that participant; the server retains the public room until an administrator closes it or the service restarts.

## Synchronization model

- Player state is sent at 20 Hz for responsive movement. Server-authoritative world time remains at 5 Hz because it changes much more slowly.
- Online time advances from the Mod's unscaled authoritative clock, so opening pause/settings UI on any computer cannot stop or fork room time.
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

Development requires the .NET 8 SDK and Visual Studio x64 C++ tools for NativeAOT linking. See the
[development guide](docs/DEVELOPMENT.md) and [architecture overview](docs/ARCHITECTURE.md).

```powershell
./build.ps1 -Install
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-save-crypto
```

See [VERIFICATION.md](VERIFICATION.md) for the verified scope and evidence paths.

## Supported environment

- Windows x64
- Fallen Flower with the dedicated Mod launcher
- Ubuntu/Linux server with Docker Engine and the Compose plugin
- Matching game and Mod versions for every participant

## License

This is proprietary, non-public-source software. Personal use of an authorized binary copy is permitted; source disclosure, redistribution, modification and commercial use require prior written permission. See [LICENSE](LICENSE).
