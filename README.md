# Fallen Flower Multiplayer — dedicated server edition

Multiplayer Mod for **Fallen Flower** with one-click public rooms, retained local direct play, synchronized avatars and isolated per-player online saves.

`PlayerHostedMultiplayer` remains the package identifier for upgrade compatibility. Public rooms use the separately deployed Ubuntu service; local Host/Join remains available from the main Multiplayer page.

> **Compatibility:** all players need matching game and Mod versions. Room-server changes are deployed automatically from `main`.
>
> **Transport security:** the room protocol is length-prefixed JSON over plain TCP, not TLS. Endpoint obfuscation and save-file encryption do not encrypt network traffic. Do not reuse sensitive passwords as an administrator token.

[简体中文说明](docs/PROJECT.zh-CN.md) · [Documentation](docs/README.md) · [API / 错误码](docs/PROTOCOL.zh-CN.md) · [Verification](docs/VERIFICATION.md) · [License](docs/LICENSE)

## Release artifacts

- Player package: `artifacts/PlayerHostedMultiplayer-v0.14.0-win-x64.zip`

Both files are uploaded to the matching public GitHub Release by the publishing workflow. The workflow can also be rerun manually from the Actions page.

## Install and play

1. Import `PlayerHostedMultiplayer-v0.14.0-win-x64.zip` with the game's Mod launcher.
2. Start the game through that launcher.
3. Select **Multiplayer** above **New Game**.
4. Enter a player name, open **Public servers**, review the real server-managed room list and choose a room.

The ZIP contains a self-contained Windows x64 NativeAOT bridge. Players do not install Node.js, TypeScript, .NET, Visual Studio or a separate launcher script. The Mod never writes the Windows registry, installs a service, requests elevation or runs an installer. Runtime preferences stay in game memory; session identity is carried by the Mod's rotating JSON state files and online-save filenames. Public play needs outbound TCP only; players do not open an inbound port.

The Mod keeps its own diagnostic log at `Mods/PlayerHostedMultiplayer/Logs/PlayerHostedMultiplayer.log`. It is capped at 4 MiB and retains one `PlayerHostedMultiplayer.previous.log`; bridge crashes also create `PlayerHostedMultiplayer.crash.log` in that directory.

For local direct play, use **Host** or **Join** with an address and port. A direct host may need a Windows firewall rule and router port forwarding when players connect from outside its LAN.

## Current behavior

- `public-1` is the permanent server room and remains listed when every player leaves. When every joinable room is full the server creates another room automatically; only redundant non-permanent empty rooms are reclaimed. `FF_ROOM_MAX_PLAYERS` is the sole public-room capacity setting.
- `localMaxPlayers` in the player Mod configuration applies only when this PC hosts a local direct room. Public clients cannot choose or reduce server room capacity.
- The Ubuntu service is logical authority peer `0`. Every public player receives the room's smallest available positive ordinary-member ID; released IDs are reused immediately, and the first player has no special authority.
- The server owns membership, the 5 Hz shared room phase, scene arbitration and unanimous sleep approval. A fresh or newly emptied public room starts in the morning; one complete room cycle lasts 3,600 real seconds. Absolute story days remain in each player's save and are never copied into the room clock. It relays player-owned state but does not run Unity gameplay or store player saves.
- No separate heartbeat traffic is generated. Existing TCP game/control frames refresh connection activity; after five minutes without a complete frame, the server closes the stale connection and releases the member through the same leave path used by a normal exit.
- A connected player whose world position does not move by at least 0.05 units and does not change scene for five minutes is also treated as AFK and removed through that same cleanup path.
- Player transform/action snapshots are sent at 20 Hz. Remote transforms, animation layers and clothing bones update every render frame.
- Clothing, skin tan, customization, the complete `GameManager.GetSave()` profile snapshot and smaller live-status packets are transferred for remote representation and player information. Remote progress is never merged into another player's local save.
- Opening the online pause menu does not pause the world. Its Multiplayer page is read-only and shows room identity, synchronized time, population and players. Hold `Tab` for the centered player list.
- The main menu shows the Mod version immediately to the left of the game's version text; it reads the same `mod/info.json` version used for the player ZIP name.
- Server-authoritative room time continues while menus are open. A new player adopts the existing room phase without replacing it or inheriting another player's story day. Sleep advances after every connected player requests the same mode; each current player advances their own story day only when the shared room phase crosses midnight.

The embedded public endpoint is AES-GCM-obfuscated inside the native bridge and is absent from editable configuration and UI text. This prevents casual editing; it is not secret management because the client contains the decryption material.

## Save isolation

Each player owns one persistent `MPOnline_<UUIDv7>.save`. The server never receives or stores this file.

1. On entry, the bridge authenticates and decrypts `MPOnline` into a temporary `MPActive_<UUIDv7>.save` because the game can only load its native `Encrypted` format.
2. Loading is a read-only transaction. Game-side and bridge-side write gates reject autosaves until loading finishes.
3. After `LoadGame` completes, the temporary `MPActive` file is deleted.
4. Online autosave redirects native `SaveGame("AutoSave")` to temporary `MPActive`; after the native write returns, the bridge validates HMAC/decryption/JSON, atomically replaces `MPOnline`, then deletes `MPActive`.
5. Interacting with a bed adds a native-style **Save game** option that commits and verifies `MPOnline` on demand.
6. The pause-menu Exit button keeps the game's original behavior; if that flow invokes native AutoSave, it uses the same validated two-phase commit without blocking exit.

The persistent authoritative file therefore remains `MPOnline` only. `MPActive` exists only until a fully validated atomic promotion completes; failures leave the previous `MPOnline` unchanged. Single-player `AutoSave.save` is neither read nor written by the online-save pipeline, and online files are hidden from the original load/save UI.

The inner layer matches the game's PBKDF2-SHA256/AES-256-CBC/HMAC-SHA256 `Encrypted` format. The outer Mod layer uses PBKDF2-SHA256 and AES-256-GCM authenticated encryption. This protects files at rest, not network traffic.

## Build and deploy

Developers need the .NET 8 SDK and Visual Studio x64 C++ tools:

```powershell
./build.ps1 -Install
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-save-crypto
```

Server administrators should follow [server/README.md](server/README.md). Contributors should start with the [development guide](docs/DEVELOPMENT.md) and [architecture](docs/ARCHITECTURE.md).

## Supported environment

- Windows x64 player computers
- Fallen Flower with the dedicated Mod launcher
- Ubuntu/Linux server with Docker Engine and Compose
- TCP/IPv4 or IPv6 connectivity to the configured room-server port

## License

This is proprietary, non-public-source software. Personal use of an authorized binary copy is permitted; source disclosure, redistribution, modification and commercial use require prior written permission. See [LICENSE](docs/LICENSE).
