# Verification — v0.14.1

- Fixed all scene interaction points disappearing after reopening an online save by allowing the native load transaction to call `PlayerStatus.SetTime` and refresh scene conditions/interactions.
- Fixed the player remaining locked after a school class by allowing story transactions to complete their native `AddTime/AddDay` calls; authoritative `worldTime` now reconciles the phase afterward.
- Window polling now requires a live `WindowManager.Singleton`, preventing the shutdown-time `IsOpened` null reference seen in `Player.log`.
- The build now rejects any future attempt to register interception hooks for these three native time methods.

Status updated 27 September 2026. This document separates current automated checks from earlier full-game evidence so old results are not presented as proof of newly changed save behavior.

## Current automated checks

The current NativeAOT bridge passes:

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-save-crypto
```

```text
PASS UUIDv7 rename, read-only load transaction, validated AutoSave two-phase commit, single-file online save, clothing metadata, online-save crypto, malformed working-copy rejection, temporary load copy, latest-save discovery, tamper rejection and AutoSave isolation
```

The dedicated runtime-log self-test also passes:

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-runtime-log
```

```text
PASS dedicated Mod log path, bridge/game entries and IPC exclusion
```

Public time is now a server-owned relative room phase. A legacy `serverTimeSeed` containing a player's
nighttime save is ignored; the first clock remains morning at `roomCycle=0`. A joining player baselines
the current cycle, so prior room days are not copied into their story date. When the final member leaves,
the permanent room resets its phase, scene and cycle to a fresh morning session.

The bed-window regression was traced to two concrete native/runtime faults and corrected: the game's
`SleepToTomorrow` callback only calls `SetTime(3)`, which turns 20:00 into roughly 23:00 without advancing
the day, while UcModLauncher cannot construct a new `ButtonClickedEvent`. The Mod now reuses each existing
event, binds through `AddListener` with the launcher extension as a fallback, and applies an explicit
`day + 1, timeOfDay = 0` result after server approval. Native sleep buttons are re-enabled after the game
sets their evening state, and the cloned manual-save button receives its own save-session availability
instead of inheriting the disabled short-sleep state. Server-side short sleep now advances the day on a
period `3 -> 0` rollover as well.

The production build also runs a mandatory runtime-safety scan before generating the package. It rejects registry-backed game preferences, direct Windows registry APIs, elevation requests and common installer/package-manager commands. The current source, generated `mod/main.ts` and installed payload contain none of those APIs. The packaged and installed bridge executables have the same SHA-256 hash.

This test verifies that:

- `MPOnline_<UUIDv7>.save` is the only persistent normal save.
- `MPActive` is a temporary native-format load copy and is released after loading.
- A complete AutoSave `MPActive` is validated and atomically promoted; malformed input leaves the prior formal save byte-for-byte unchanged.
- `prepareSave` disables writes; an attempted incomplete snapshot returns `-8` and leaves the complete formal file byte-for-byte unchanged.
- Saving commits directly and atomically to the double-encrypted `MPOnline` container.
- The bridge does not monitor, redirect, back up, restore or otherwise modify `AutoSave.save`.
- The Mod outer AES-GCM layer round-trips correctly and rejects tampering.
- UUIDv7 migration, latest-save discovery and active-only legacy recovery work.
- Clothing is included in load metadata so the runtime avatar can reapply the saved equipped list without editing the stored JSON.
- Native `GameManager.AutoSaving()` is intercepted directly because its IL2CPP implementation tail-jumps to the native `SaveGame` address and bypasses a `SaveGame` entry hook. The complete native save is redirected through `MPActive` without filtering any JSON fields.
- Remote clothing is instantiated only on the inactive visual clone; the local player's outfit is never temporarily replaced, and old proxies are hidden before deferred destruction.

The current room adapter self-test also passes when the test server is started with capacity two, a test-only three-second TCP inactivity timeout and a ten-second AFK timeout:

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe `
  --self-test-room-relay --address 127.0.0.1 --port 28783
```

With the test server capacity set to two, `FF_ROOM_CLIENT_TIMEOUT_SECONDS=3` and `FF_ROOM_AFK_TIMEOUT_SECONDS=10`, it verifies that a fresh server exposes exactly one real room, rejects a first player's nighttime clock seed, lets a single player sleep into room cycle 1, advances the phase at 240 native units per configured 3,600-second cycle, creates a new room when two ordinary clients fill the first, retains peer `0` authority, relays bidirectionally, approves unanimous sleep, reuses the smallest released ID, and removes inactive/AFK connections. After all test players disconnect, the final list contains exactly the empty permanent `public-1`; re-entering it produces `roomCycle=0` at morning rather than the prior session's time. Production defaults both timeout thresholds to 300 seconds and sends no standalone heartbeat.

```text
PASS server-owned room phase, player-seed rejection, empty-room morning reset, permanent room, solo/unanimous sleep, timeouts, reusable peer IDs and relay
```

## Full-game evidence

| Evidence | Finding | Path |
| --- | --- | --- |
| Two real game processes over the LAN | Framing, handshake, peer assignment, bidirectional state/profile/live-data transfer and remote models passed | `artifacts/dual-instance/20260927-105653/evidence/summary.json` |
| Post-cleanup two-game regression | Non-empty clothing, skin tan, 182 clothing bones, movement/actions and cross-scene following passed | `artifacts/dual-instance/20260927-111836/evidence/summary.json` |
| Visible online pause-window run | Pause UI stayed visible while `Paused=false`, `timeScale=1`; the world advanced and the phone opened afterward | `artifacts/dual-instance/20260927-111811/evidence/summary.json` |
| Earlier online-save lifecycle run | UUIDv7 creation/reopen, exit save, position restoration and bridge shutdown passed for the former retained-active design | `artifacts/online-save/20260927-102017/evidence/summary.json` |
| NativeAOT room-relay process run | Two clients created/joined a public room and exchanged payloads through server authority | `artifacts/room-relay-nativeaot-server.log` |

The earlier online-save lifecycle evidence predates the single-persistent-file/read-only-load change. It remains useful for game integration and position loading, but it is **not** evidence that the new temporary-active lifecycle has completed a real-game regression. The current self-test covers the new file and write-gate semantics.

Additional observed results from the two-game runs:

- Player scheduling was configured for 20 Hz; two full game processes sharing one machine observed 17.43 Hz end-to-end while render interpolation continued each frame.
- Material restoration covered 14 renderers and 21 private material instances per side with zero invalid/error shaders in that run.
- The historical two-game test did not change original `AutoSave*.save` hashes. Current source redirects native online autosaves to isolated `MPActive`, then explicitly validates and atomically promotes them without handling offline AutoSave.
- The public endpoint accepted the framed protocol and returned `pong`; TCP reachability was confirmed externally.

## Remaining verification

- Run two real game clients through the deployed Ubuntu public endpoint after both player and server builds are updated to the same commit.
- Repeat the create/bed-save/quit/reopen game lifecycle and verify the save directory contains only `MPOnline` after loading and after exit.
- Verify the bed window contains the native-style manual-save option, and that pause-menu Exit quits immediately without issuing a save command.
- Hash `AutoSave.save` before and after an online autosave/bed-save regression to verify the game Hook on the target build.
- Verify equipped clothing, inventory, quests, achievements/progression, position and phone behavior after reopening the same online UUID.
- Network traffic is plain TCP and has not been penetration-tested or tested behind TLS termination.

## Package boundary

The player ZIP contains runtime Mod files, six language packs, English/Chinese player instructions and licenses, profile maps, and one self-contained NativeAOT executable. It does not include source, tests, installers, services, startup scripts, Node.js, the .NET SDK, Visual Studio or the Ubuntu server. Runtime diagnostics are written under the installed Mod's `Logs` directory, capped at 4 MiB with one previous file; exceptional bridge crashes use the same directory. Other persistent output is limited to rotating JSON snapshots and online files in the game's save directory. The Mod does not use the Windows registry.
