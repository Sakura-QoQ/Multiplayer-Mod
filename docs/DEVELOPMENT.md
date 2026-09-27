# Development guide

Player machines need only the release ZIP and the game's Mod launcher. The tools below are required
only on a development PC.

## Prerequisites

- .NET 8 SDK
- Visual Studio x64 C++ build tools for NativeAOT linking
- A local Fallen Flower installation for `-Install` and game integration tests

Node.js and the TypeScript compiler are not used. The in-game files use TypeScript-style syntax
under UcModLauncher's Jint environment and are assembled as text.

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

## Run verification

```powershell
dotnet run --project ./src/MultiplayerBridge.SmokeTest -c Release
```

The smoke test validates the bridge protocol, transport, save encryption and core state handling.

## Release boundary

The player ZIP contains generated Mod files, six language packs, two player README files, two
license files, the player-profile field maps and one self-contained Windows bridge executable. It
does not contain source, tests, SDKs, build tools or the experimental Ubuntu room server.
