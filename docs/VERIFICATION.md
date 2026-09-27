# Verification — v0.13.4

Status updated 27 September 2026. This document separates current automated checks from earlier full-game evidence so old results are not presented as proof of newly changed save behavior.

## Current automated checks

The current NativeAOT bridge passes:

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-save-crypto
```

```text
PASS UUIDv7 rename, read-only load transaction, validated AutoSave two-phase commit, single-file online save, clothing metadata, online-save crypto, malformed working-copy rejection, temporary load copy, latest-save discovery, tamper rejection and AutoSave isolation
```

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

The current room adapter self-test also passes when the test server is started with capacity two, a test-only three-second TCP inactivity timeout and a ten-second AFK timeout:

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe `
  --self-test-room-relay --address 127.0.0.1 --port 28783
```

With the test server capacity set to two, `FF_ROOM_CLIENT_TIMEOUT_SECONDS=3` and `FF_ROOM_AFK_TIMEOUT_SECONDS=10`, it verifies that a fresh server exposes exactly one real room, a single player can sleep until the server-owned next day, the clock advances at 240 native period units per configured 3,600-second day, two ordinary clients fill the room, the server creates the next room, authority remains peer `0`, bidirectional relay and unanimous sleep work, a replacement receives the smallest released ID, a silent connection is removed by TCP inactivity cleanup, and a connection continuously sending a fixed position is removed as AFK. Production defaults both timeout thresholds to 300 seconds and sends no standalone heartbeat.

```text
PASS public room auto-entry, one-hour clock, solo and unanimous sleep, TCP inactivity and AFK timeouts, reusable peer IDs, server authority and bidirectional relay
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

The player ZIP contains runtime Mod files, six language packs, English/Chinese player instructions and licenses, profile maps, and one self-contained NativeAOT executable. It does not include source, tests, installers, services, startup scripts, Node.js, the .NET SDK, Visual Studio or the Ubuntu server. Persistent output is limited to the Mod's JSON snapshots, an exceptional crash log beside them, and online files in the game's save directory; the Mod does not use the Windows registry.
