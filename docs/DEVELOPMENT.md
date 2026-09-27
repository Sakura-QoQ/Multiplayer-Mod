# Development guide

This repository builds two deliverables: the Windows player Mod and the Linux Docker room server.
Player machines need only the Mod ZIP and game launcher; production traffic uses the room server.

## Prerequisites

- .NET 8 SDK
- Visual Studio x64 C++ build tools for NativeAOT linking
- A local Fallen Flower installation for `-Install` and game integration tests
- Docker Engine with the Compose plugin for container validation

Node.js and the TypeScript compiler are not used. The in-game files use TypeScript-style syntax
under UcModLauncher's Jint environment and are assembled as text.

The bridge never opens or modifies the Windows registry. Game-to-bridge commands use marked lines in
Unity `Player.log`; bridge-to-game snapshots use rotating JSON files inside the Mod's `Bridge` directory.

## Build and install

```powershell
./build.ps1 -Install
```

The version is read from `mod/info.json`. Output is written to
`artifacts/PlayerHostedMultiplayer-v<version>-win-x64.zip` and `-Install` copies the same payload to
the game's `Mods/PlayerHostedMultiplayer` directory. After a successful restore, an offline rebuild
can use `./build.ps1 -Install -NoRestore`.

Edit only files under `src/GameMod`; `mod/main.ts` and runtime language files are generated. When a
module is added, place it in `src/GameMod/source-order.json`. The build fails on missing/orphaned
modules, duplicate manifest entries, direct low-level control creation inside page modules, or
translation-key differences.

Build the production room server from the repository root:

```bash
cd server
cp .env.example .env
docker compose build
docker compose up -d
```

## Run verification

Build both .NET components and run the save self-test:

```powershell
dotnet build ./src/MultiplayerBridgeHost/MultiplayerBridgeHost.csproj -c Release
dotnet build ./src/MultiplayerRoomServer/MultiplayerRoomServer.csproj -c Release
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-save-crypto
```

For the room-relay integration test, start `MultiplayerRoomServer` on a test port, then run:

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe `
  --self-test-room-relay --address 127.0.0.1 --port 28783
```

The test creates two bridge clients, sends `room.enter` from both, verifies automatic public-room creation/joining and authority mapping, then relays
payloads in both directions. See `VERIFICATION.md` for game-level coverage and remaining limits.

`src/MultiplayerBridgeHost/PublicServerEndpoint.cs` contains the encrypted production endpoint.
Changing the endpoint requires generating a fresh AES-GCM nonce, tag and ciphertext together; never
place its plaintext in `mod/config.json`, GameMod source, UI strings or player documentation.

## Release boundary

The player ZIP contains generated Mod files, six language packs, two player README files, two
license files, the player-profile field maps and one self-contained Windows bridge executable. It
does not contain source, tests, SDKs, build tools or the separately deployed Ubuntu room server.

The server deployment contains `server/`, `src/MultiplayerRoomServer/` and the license files. It does
not contain the game, player saves, Mod scripts or Windows development tools.
