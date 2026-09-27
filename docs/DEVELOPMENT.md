# Development guide

This repository produces a self-contained Windows player Mod and a separately deployed Linux room server. Player computers need only the generated ZIP and the game Mod launcher.

## Prerequisites

| Task | Required software |
| --- | --- |
| Build the Windows bridge | .NET 8 SDK and Visual Studio x64 C++ tools for NativeAOT |
| Install into a development game | A local Fallen Flower installation at the repository's expected parent layout |
| Build the room server | Docker Engine with the Compose plugin, or .NET 8 SDK |
| Use the player package | No developer software; only the game and Mod launcher |

Node.js and `tsc` are not used. UcModLauncher executes TypeScript-style Jint source, and `build.ps1` concatenates it as text.

Neither the game script nor the bridge uses the Windows registry or Unity's registry-backed preference API. Commands travel through marked Unity `Player.log` lines; responses, events and current session identity use rotating JSON state files under the installed Mod's `Bridge` directory. The runtime does not elevate, install a service, run a package manager or download dependencies.

The bridge filters ordinary `[PlayerHostedMultiplayer]` entries into `Logs/PlayerHostedMultiplayer.log` under the installed Mod. File output stays outside the Unity game thread; IPC marker lines are excluded. The current log rotates at 4 MiB and keeps one previous file.

## Build the player Mod

```powershell
./build.ps1 -Install
```

The script reads the version from `mod/info.json`, generates `mod/main.ts`, copies the six runtime language packs, publishes a self-contained NativeAOT bridge, creates `artifacts/PlayerHostedMultiplayer-v<version>-win-x64.zip`, and optionally installs the same payload into `Mods/PlayerHostedMultiplayer`.

After dependencies have been restored once, an offline build can use:

```powershell
./build.ps1 -Install -NoRestore
```

Edit `src/GameMod/`, not generated `mod/main.ts` or `mod/i18n`. Add every new module to `src/GameMod/source-order.json` after its dependencies. The build rejects missing/duplicate modules, direct low-level Unity control construction in page modules, translation-key differences, registry APIs, elevation requests and installer commands in runtime source.

## Verify behavior

Build and run the runtime-log self-test:

```powershell
./build.ps1 -SkipPackage -NoRestore
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-runtime-log
```

The save-crypto self-test is retained only to verify recovery compatibility with legacy `MPOnline` files. It is not part of the current runtime save path.

To test the dedicated-room adapter, run a room server on a test port and then execute:

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe `
  --self-test-room-relay --address 127.0.0.1 --port 28783
```

This first verifies that the server never emits detailed `worldTime` and approves one-player “sleep until tomorrow”, then creates a second ordinary client and verifies coordinator peer `0`, bidirectional relay and unanimous sleep approval. Game-level evidence and limits are listed in [VERIFICATION.md](VERIFICATION.md).

When changing save code, verify that room entry invokes original `LoadSaveWindow.Load("AutoSave")` through Unity messaging, no Mod path calls `StartGame`/`GameManager.LoadGame`, bed saving preserves `GameManager.SaveName`, and no bridge save command or disk redirection is reintroduced.

## Build the server

```bash
cd server
cp .env.example .env
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100 room-server
```

The Docker build context is the repository root because the image copies `src/MultiplayerRoomServer/` and the license files. See [server/README.md](../server/README.md) for updates, firewall configuration and troubleshooting.

`src/MultiplayerBridgeHost/PublicServerEndpoint.cs` contains an encrypted production endpoint. Changing it requires a new AES-GCM nonce, tag and ciphertext. Never put the plaintext endpoint in `mod/config.json`, GameMod source, UI strings or player documentation. Remember that endpoint obfuscation is not TLS.

## Release contents

The player ZIP contains generated Mod files, six language packs, English/Chinese player instructions and licenses, English/Chinese profile maps, and one self-contained Windows executable. It excludes source, tests, SDKs, build tools and the Linux server.

The server deployment requires `server/`, `src/MultiplayerRoomServer/`, `docs/LICENSE` and `docs/LICENSE.zh-CN`. It does not require the game, player saves, Mod script or Windows toolchain.
