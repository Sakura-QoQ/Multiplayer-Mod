# Verification — 1.1.1

## Automated results

Verified on 2026-09-28:

| Check | Result |
| --- | --- |
| `tools/Build-Mod.ps1 -Install` | PASS; NativeAOT player bridge packaged and installed |
| Room server Release build | PASS; 0 warnings, 0 errors |
| Multiplayer bridge Release build | PASS; 0 warnings, 0 errors |
| Bridge host Release build | PASS; 0 warnings, 0 errors |
| Direct TCP `MultiplayerBridge.SmokeTest` | PASS |
| Dedicated room relay end-to-end test | PASS |
| Runtime log self-test | PASS |
| `git diff --check` and source/translation/build gates | PASS |

The room-relay test covers the shared server/Mod version handshake and `2012`/`426` mismatch response, permanent rooms, peer-ID reuse, bidirectional relay, solo and unanimous sleep, client/AFK timeouts, request throttling, server-authority spoof rejection, public profile-chunk rejection, and the absence of server `worldTime` broadcasts.

The bed integration now preserves both native `ButtonClickedEvent` instances. The original buttons keep their layout and interactable state while independent consensus events temporarily handle clicks; approval invokes the preserved native callback so the current game build owns day rollover, quest flags, interaction refresh and window cleanup. The build rejects direct sleep-time reconstruction or removal of native bed listeners. Relay draining is capped at 80 requests/second, below the server's 120 requests/second limit.

## Build-enforced regressions

The release build rejects:

- registry/elevation/installer APIs;
- hooks on native `PlayerStatus.SetTime/AddTime/AddDay` transactions;
- writes to `timeScale`, game time, offset or story day;
- synthetic `StartGame`/`GameManager.LoadGame` save loading;
- a native default-save flow that does not initialize, load and hide the picker in the same frame;
- hard-coded `SaveGame("AutoSave")` writes that would ignore the active native slot;
- missing/duplicated Game Mod modules and mismatched translation keys.

## Save behavior inspected

The runtime initializes the original loader, invokes `LoadSaveWindow.Load("AutoSave")`, and hides the picker in the same frame. It does not create a new-game state, enumerate save files or expose bridge save commands. Automatic, bed and quit saving stay in the game's native workflow. Legacy `MPOnline`/`MPActive` files are not touched.

## Security regression

Malicious ordinary clients cannot target another public peer directly, forge server-only packet types, forge identity in a profile chunk, inject control/rich-text characters into display fields, exceed the connection request budget indefinitely, or hold unauthenticated/send operations open without a deadline. Network profiles contain an explicit appearance/aggregate-count allowlist instead of complete save JSON.

## Real-game acceptance checklist

The generated package is installed at `D:\FallenFlower\Mods\PlayerHostedMultiplayer`. Before distributing broadly, test one current game build for: join without a visible save picker; clothing/tasks/interactions retained after load; bed and automatic saves; solo and two-player sleep; class completion without control lock; clean exit to menu/desktop; bounded phone layout and Contacts. These Unity/IL2CPP behaviors cannot be proven by the headless .NET suite alone.
