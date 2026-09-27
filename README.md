# PlayerHostedMultiplayer

Player-hosted multiplayer for **Fallen Flower**. One player's Windows PC hosts the room and runs the bundled network bridge; no central server or separate runtime installation is required.

[简体中文说明](README.zh-CN.md) · [Player profile field map](PLAYER_PROFILE_FIELDS.md) · [Verification report](VERIFICATION.md) · [License](LICENSE)

## Features

- Native-style multiplayer entry on the main menu and multiplayer settings in the pause menu.
- Host or join directly from the in-game UI. The pause menu remains visible while the world, physics, animation and online clock continue running behind it.
- Up to four players by default; the host acts as the authoritative relay.
- Hold `Tab` in an online game to show the localized room-player list in the center of the screen.
- Player model, position, rotation, movement, grounded state, weapon, action and all Animator layers are synchronized.
- Clothing, skin tan, character customization, complete save-profile data and continuously changing player status are synchronized.
- Player movement snapshots are sent at 20 Hz; remote transforms and clothing bones are still updated every render frame.
- The Mod owns online time progression: the host advances one authoritative unscaled clock and clients continuously calibrate to it. Sleeping advances time only after every connected player agrees on the same sleep mode.
- Online saves use one persistent UUIDv7 per player and never appear in the single-player load/save UI.
- Exiting online mode saves and verifies the online file before quitting.

## Installation

1. Import `PlayerHostedMultiplayer-v0.9.0-win-x64.zip` with the game's dedicated Mod launcher.
2. Start the game through that Mod launcher.
3. Select **Multiplayer** above **New Game** on the main menu.

The package contains a Windows x64 NativeAOT bridge and all of its runtime dependencies. Players do **not** need Node.js, TypeScript, .NET, Visual Studio or a separate start script.
The bridge runs with the current user's normal token and does not request administrator elevation.
Windows Defender Firewall may still show its normal one-time inbound-network prompt when a PC hosts
for the first time; that is separate from repeated launch permission prompts.

## Hosting and joining

- **Host:** choose a player name, port and maximum player count, then select **Host and Enter**. The Mod resumes that player's UUIDv7 online save, or creates the first online save from a clean game when none exists.
- **Join:** enter the host address and port, then select **Join**. Every player keeps an independent online save and personal progress.
- **LAN:** use the host PC's LAN IPv4 address, for example `192.168.1.20`.
- **Internet:** the host must allow the configured TCP port through Windows Firewall and usually forward it on the router, or use a trusted virtual-LAN tool.

All players should use the same game and Mod versions. The default TCP port is `27777`.

The editable in-game source lives under `src/GameMod`. `build.ps1` concatenates modules in
`source-order.json` into `mod/main.ts`, because the Mod launcher's Jint environment requires one
script entry and does not resolve TypeScript imports. No Node.js or TypeScript installation is
required on a player's computer. The script communicates with the bundled bridge through bounded
commands and atomic state snapshots. TCP messages use a four-byte big-endian length prefix followed
by UTF-8 JSON, with size and queue limits.

## Synchronization model

- Player state is sent at 20 Hz for responsive movement. Authoritative world time remains at 5 Hz because it changes much more slowly.
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

# Install

PlayerHostedMultiplayer — Installation Guide
Requirements
- Fallen Flower for Windows x64
- The game’s dedicated Mod launcher
- The same game and Mod version for every player
No additional software is required. You do not need to install Node.js, TypeScript, .NET, Visual Studio, or a separate server program.
Installation
1. Download PlayerHostedMultiplayer-v0.9.0-win-x64.zip.
2. Open the game’s dedicated Mod launcher.
3. Import the ZIP package directly. Do not extract individual files into the game directory.
4. Make sure PlayerHostedMultiplayer is enabled in the Mod launcher.
5. Start Fallen Flower through the Mod launcher.
6. On the main menu, select Multiplayer, located above New Game.
The bundled MultiplayerBridgeHost.exe starts automatically when multiplayer is used. No separate start script is required.
Hosting a Room
1. Open Multiplayer.
2. Enter your player name.
3. Select a TCP port. The default is 27777.
4. Choose the maximum number of players.
5. Select Host and Enter.
The Mod will automatically load your existing online save. A new online save is created only if you do not already have one.
Joining a Room
1. Open Multiplayer.
2. Enter your player name.
3. Enter the host computer’s IP address.
4. Enter the same port selected by the host.
5. Select Join.
For a local network, use the host computer’s LAN IPv4 address, such as 192.168.1.20. Do not use 127.0.0.1 unless both game instances are running on the same computer.
Internet Hosting
To host over the public Internet, the host may need to:
- Allow the selected TCP port through Windows Firewall.
- Forward that TCP port to the host computer in the router settings.
- Share the public IP address with other players.
A trusted virtual-LAN application may be used instead of router port forwarding.
Online Saves
Online saves are separate from single-player saves:
- MPOnline_<UUIDv7>.save is the primary online save.
- MPActive_<UUIDv7>.save is the recovery copy.
- Online saves do not appear in the original single-player load/save menu.
- Leaving online mode saves and verifies the online file automatically.
- Single-player AutoSave*.save files are not overwritten.
Troubleshooting
If the Multiplayer button does not appear:
1. Confirm that the Mod is enabled.
2. Start the game through the Mod launcher.
3. Confirm that the complete ZIP package was imported.
4. Make sure all players use the same Mod and game versions.
If another player cannot connect:
1. Confirm that the host has already entered the room.
2. Check the IP address and TCP port.
3. Allow MultiplayerBridgeHost.exe through Windows Firewall.
4. Verify router port forwarding when playing over the Internet.
5. Make sure no other application is already using the selected port.
