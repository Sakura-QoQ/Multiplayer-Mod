# Verification — 1.1.11

## Earlier automated results

The following records predate this menu refactor (2026-09-28); the server/network suite was not rerun for this UI-only change.

| Check | Result |
| --- | --- |
| `tools/Build-Mod.ps1 -Install` | PASS; NativeAOT player bridge packaged and installed |
| Room server Release build | PASS; 0 warnings, 0 errors |
| Multiplayer bridge Release build | PASS; 0 warnings, 0 errors |
| Bridge host Release build | PASS; 0 warnings, 0 errors |
| Direct TCP `MultiplayerBridge.SmokeTest` | PASS |
| Dedicated room relay end-to-end test | PASS |
| Runtime log self-test | PASS |
| `git diff --check` and source/translation completeness checks | PASS |

The room-relay test covers the shared server/Mod version handshake and advisory mismatched-version acceptance, permanent rooms, peer-ID reuse, bidirectional relay, solo and unanimous sleep, client/AFK timeouts, request throttling, server-authority spoof rejection, public profile-chunk rejection, and the absence of server `worldTime` broadcasts.

The bed integration now preserves both native `ButtonClickedEvent` instances. The original buttons keep their layout and interactable state while independent consensus events temporarily handle clicks; approval invokes the preserved native callback so the current game build owns day rollover, quest flags, interaction refresh and window cleanup. Relay draining is capped at 80 requests/second, below the server's 120 requests/second limit.

## Current build checks

Only source-manifest completeness and translation keys are checked; source-pattern policy gates were removed.

## Save behavior inspected

The runtime initializes the original loader, invokes `LoadSaveWindow.ExecuteLoad("AutoSave")`, and hides the picker in the same frame without waiting for the hidden confirmation prompt. It does not create a new-game state, enumerate save files or expose bridge save commands. Automatic, bed and quit saving stay in the game's native workflow. Legacy `MPOnline`/`MPActive` files are not touched.

## Security regression

Malicious ordinary clients cannot target another public peer directly, forge server-only packet types, forge identity in a profile chunk, inject control/rich-text characters into display fields, exceed the connection request budget indefinitely, or hold unauthenticated/send operations open without a deadline. Network profiles contain an explicit appearance/aggregate-count allowlist instead of complete save JSON.

## Real-game acceptance checklist

The generated package is installed at `D:\FallenFlower\Mods\Multiplayer`. Before distributing broadly, test one current game build for: join without a visible save picker; clothing/tasks/interactions retained after load; bed and automatic saves; solo and two-player sleep; class completion without control lock; clean exit to menu/desktop; bounded phone layout and Contacts. These Unity/IL2CPP behaviors cannot be proven by the headless .NET suite alone.

## Menu lifecycle fix

Main-menu buttons are created on the next frame. Pause buttons are resolved within the current window. The UI loop uses the persistent canvas runner. `node tools/Test-MenuLifecycle.mjs` covers window recreation, reopen reuse, layout and loop ownership. Real-game visual acceptance is still required for first launch, ESC after loading, and returning to the menu then re-entering.

Current change passed: offline build/install, menu lifecycle mock tests, generated-script syntax, and `git diff --check`.

## Cold-start missing menu: confirmed cause

Real-game logs showed session cleanup in `MainMenu.Awake` reading an absent `Bridge/state.<channel>.<slot>.json`. The host FileNotFoundException escaped JavaScript catch and aborted UI creation. Snapshot reads now use the game-provided `ModFileExists` and return not-ready for absent files. Real-game verification showed the entry and version label, and an open multiplayer panel. Cold-start missing-file regression passed. The public endpoint refused connections during verification; online room listing was not verified.

## 1.1.11 rooms and advisory versions

Client regressions passed: mismatched versions show rooms, allow clicks, submit entry and load the save while warning once. TCP relay tests accepted both older and newer versions. The production probe returned ECONNREFUSED before protocol negotiation; production recovery must still be verified after deployment. Deployment now builds before replacing the running container.
