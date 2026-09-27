# Verification — v0.14.7

- The generated transparent PNG is now the complete phone-body material. Original direct XWindow chrome is disabled after its dynamic pages are moved into the replacement screen.
- Multiplayer now sets and loads the native `AutoSave`; automatic and bed saves call the game's ordinary save path without creating or committing `MPOnline`/`MPActive`.
- The bridge runtime no longer restores a baseline, watches AutoSave, promotes temporary saves, or processes an isolated save during shutdown. Legacy online files remain untouched on disk.

- The complete 560×950 phone design now scales uniformly to 80% of the available window height, keeping native pages, labels, tabs, and hit areas in the same proportion.
- Reopening an existing phone window recalculates the scale to account for resolution or UI-scale changes.

- Rebuilt the phone window as a Phone 17-style front face with a rounded black body, clipped screen, Dynamic Island, status bar, three bottom tabs, and a home indicator.
- Native Home, DM, chat, and post objects remain controlled by `XWindow`; the Mod only reparents their layout so their existing interactions are preserved.
- Added a Contacts tab that reads the current multiplayer session and refreshes local and remote online players.
- Removed the global hold-Tab player list and its input polling. Player presence now appears only in the phone Contacts page.
- The component/page boundary, localization-key consistency, and generated TypeScript checks pass. Final in-game proportions still require visual confirmation at the active game resolution.

- Confirmed that lingering classroom models and the online clock fixed at 09:00 share one cause: native `ClassroomDirector.<NormalClass>d__5.MoveNext` calls `PlayerStatus.AddTime` before moving the player to the exit and clearing `_inClass`; the old server overwrote that story result with a morning phase every 200 ms.
- Public servers no longer create, advance, or broadcast `worldTime`, and `FF_ROOM_DAY_LENGTH_SECONDS` was removed. Detailed time uses each client's native game flow at the same game speed.
- The server only decides unanimous sleep among real players. It is not counted as a player and does not calculate a clock; each client applies the same approved transition. Clients also ignore `worldTime` from an older server during a rolling deployment.

- Root cause confirmed: `GameManager` has no `@hookable` marker in the generated type list, so the former `AutoSaving/SaveGame` hooks never formed a reliable isolation boundary.
- v0.14.7 retains the native `AutoSave` path introduced in v0.14.6.
- The bridge no longer scans, protects, redirects, promotes or restores save files; legacy `MPOnline`/`MPActive` files stay untouched for manual recovery.
- Disconnecting affects only networking and does not change the game's native save lifecycle.
- The build rejects any future attempt to register a `GameManager` hook.

- Fixed all scene interaction points disappearing after reopening an online save by allowing the native load transaction to call `PlayerStatus.SetTime` and refresh scene conditions/interactions.
- Fixed the player remaining locked after a school class by allowing story transactions to complete their native `AddTime/AddDay` calls; public-server `worldTime` can no longer undo those results.
- Window polling now requires a live `WindowManager.Singleton`, preventing the shutdown-time `IsOpened` null reference seen in `Player.log`.
- The build now rejects any future attempt to register interception hooks for these three native time methods.

Status updated 27 September 2026. This document separates current automated checks from earlier full-game evidence so old results are not presented as proof of newly changed save behavior.

## Current automated checks

The current NativeAOT bridge passes:

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-save-crypto
```

```text
PASS UUIDv7 rename, read-only load transaction, disk-level AutoSave isolation/crash recovery, validated two-phase commit, single-file online save, clothing metadata, online-save crypto, malformed working-copy rejection, temporary load copy, latest-save discovery and tamper rejection
```

The dedicated runtime-log self-test also passes:

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe --self-test-runtime-log
```

```text
PASS dedicated Mod log path, bridge/game entries and IPC exclusion
```

The public server no longer owns a relative room phase or detailed clock. Legacy `serverTimeSeed`,
`serverTimeCommit`, and `worldTime` packets are dropped, and the server emits no `worldTime`. Players keep
the native game time flow, so story-owned `AddTime/AddDay` calls remain effective. When the final member
leaves, only room scene and sleep-consensus state are reset.

The bed-window regression was traced to two concrete native/runtime faults and corrected: the game's
`SleepToTomorrow` callback only calls `SetTime(3)`, which turns 20:00 into roughly 23:00 without advancing
the day, while UcModLauncher cannot construct a new `ButtonClickedEvent`. The Mod now reuses each existing
event, binds through `AddListener` with the launcher extension as a fallback, and applies an explicit
`day + 1, timeOfDay = 0` result after server approval. Native sleep buttons are re-enabled after the game
sets their evening state, and the cloned manual-save button receives its own save-session availability
instead of inheriting the disabled short-sleep state. Client-side short sleep advances the day on a
period `3 -> 0` rollover as well.

The production build also runs a mandatory runtime-safety scan before generating the package. It rejects registry-backed game preferences, direct Windows registry APIs, elevation requests and common installer/package-manager commands. The current source, generated `mod/main.ts` and installed payload contain none of those APIs. The packaged and installed bridge executables have the same SHA-256 hash.

The legacy save-crypto test verifies recovery compatibility only; it is not part of the v0.14.7 runtime path. Current runtime verification confirms that:

- room entry selects and loads native `AutoSave`;
- bed saving calls the original `GameManager.SaveGame("AutoSave")`;
- the original pause-menu load/save controls remain available;
- the bridge advertises no save commands and emits an empty legacy save index;
- no runtime path scans or rewrites `MPOnline`/`MPActive` files.
- The Mod outer AES-GCM layer round-trips correctly and rejects tampering.
- UUIDv7 migration, latest-save discovery and active-only legacy recovery work.
- Clothing is included in load metadata so the runtime avatar can reapply the saved equipped list without editing the stored JSON.
- Remote clothing is instantiated only on the inactive visual clone; the local player's outfit is never temporarily replaced, and old proxies are hidden before deferred destruction.

The current room adapter self-test also passes when the test server is started with capacity two, a test-only three-second TCP inactivity timeout and a ten-second AFK timeout:

```powershell
./artifacts/bridge/win-x64/MultiplayerBridgeHost.exe `
  --self-test-room-relay --address 127.0.0.1 --port 28783
```

With the test server capacity set to two, `FF_ROOM_CLIENT_TIMEOUT_SECONDS=3` and `FF_ROOM_AFK_TIMEOUT_SECONDS=10`, it verifies that a fresh server exposes exactly one real room, rejects legacy time seeds and never emits `worldTime`, approves solo and unanimous multiplayer sleep, creates a new room when two ordinary clients fill the first, retains peer `0` authority, relays bidirectionally, reuses the smallest released ID, and removes inactive/AFK connections. After all test players disconnect, the final list contains exactly the empty permanent `public-1`; re-entering it still receives no server-owned detailed clock. Production defaults both timeout thresholds to 300 seconds and sends no standalone heartbeat.

```text
PASS client-owned detailed time, no server worldTime, permanent room, solo/unanimous sleep, timeouts, reusable peer IDs and relay
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
- The historical two-game test did not change original `AutoSave*.save` hashes. The v0.14.2 self-test additionally covers a native AutoSave write that bypasses hooks and recovery after a simultaneous bridge/game interruption.
- The public endpoint accepted the framed protocol and returned `pong`; TCP reachability was confirmed externally.

## Remaining verification

- Run two real game clients through the deployed Ubuntu public endpoint after both player and server builds are updated to the same commit.
- Repeat the enter/bed-save/quit/reopen lifecycle and verify progress persists in the ordinary `AutoSave` without creating a new `MPOnline`/`MPActive` file.
- Verify the bed window's manual-save option and the original pause-menu load/save/exit controls.
- Verify equipped clothing, inventory, quests, achievements/progression, position and phone behavior after reopening the same `AutoSave`.
- Network traffic is plain TCP and has not been penetration-tested or tested behind TLS termination.

## Package boundary

The player ZIP contains runtime Mod files, six language packs, English/Chinese player instructions and licenses, profile maps, and one self-contained NativeAOT executable. It does not include source, tests, installers, services, startup scripts, Node.js, the .NET SDK, Visual Studio or the Ubuntu server. Runtime diagnostics are written under the installed Mod's `Logs` directory, capped at 4 MiB with one previous file; exceptional bridge crashes use the same directory. Other persistent output is limited to rotating JSON snapshots and online files in the game's save directory. The Mod does not use the Windows registry.
