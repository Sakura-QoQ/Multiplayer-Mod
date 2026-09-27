# Public-server edition verification report — v0.12.0

Verified on 27 September 2026. Direct compatibility behavior used two real `FallenFlower.exe`
processes and two isolated bridges; dedicated-server behavior used the published NativeAOT bridge,
a real room-server process and the deployed public endpoint.

## Verified behavior

- Both game processes connected through the machine's LAN adapter address `192.168.37.127`, not a loopback address.
- TCP framing, protocol negotiation, peer assignment and bidirectional messages passed.
- Both processes created remote player models and received full profile and live-status data.
- Non-empty clothing, skin tan, all 182 clothing bones, actions, movement and cross-scene following passed.
- Remote material restoration covered 14 renderers and 21 private material instances on each side; both reported zero invalid/error shaders, and both tan materials were applied.
- Player-state scheduling is configured at 20 Hz. The end-to-end two-game stress run observed 17.43 Hz while both full game instances shared one machine; rendering interpolation continued every frame.
- The Mod-owned authoritative clock advanced continuously on the host and calibrated the client throughout the session. Host time packets, unanimous sleep and client application all passed.
- With the original `PauseWindow` kept visibly open, `GameManager.Paused` was false, `timeScale` was 1, and the authoritative clock advanced by 1.01 seconds during the one-second observation window.
- The online pause menu remained visible while world time continued; its Multiplayer entry showed only the read-only room information/time/player page, and the phone window opened normally afterward.
- The two-process test did not change any original `AutoSave*.save` hash.
- The online-save lifecycle created a UUIDv7 file, saved on exit, reopened the same UUID, restored the saved position within collision correction tolerance, preserved the recovery copy, and released its bridge port.
- The bridge save self-test passed encryption round-trip, tamper rejection, UUIDv7 migration, save retention and single-player restoration.
- The published NativeAOT bridge sent `room.enter` from two ordinary clients through a real local server process, automatically created/joined one public room, kept logical peer zero on the server, preserved positive member identities, relayed payloads in both directions, received the server clock and completed server-approved unanimous sleep.
- The deployed public endpoint accepted the framed protocol and returned a valid `pong` response; TCP reachability was also confirmed externally. The deployed container must be updated to v0.12.0 before clients use the live public-room list.
- After testing, no game or bridge process and no test listening port remained.

## Evidence

- Two-process LAN test: `artifacts/dual-instance/20260927-105653/evidence/summary.json`
- Post-cleanup full two-process regression: `artifacts/dual-instance/20260927-111836/evidence/summary.json`
- Visible online pause-menu/read-only-room-page/background-running test: `artifacts/dual-instance/20260927-111811/evidence/summary.json`
- Online-save lifecycle, including recovery from an `MPActive_`-only state: `artifacts/online-save/20260927-102017/evidence/summary.json`
- Dedicated-room NativeAOT server log: `artifacts/room-relay-nativeaot-server.log`

The automated LAN test covers the retained direct-compatibility path on one Windows machine. The
public-room relay protocol and public endpoint passed process-level tests. A two-game run through the
public Ubuntu endpoint remains the final deployment verification and is not claimed as completed.

## Package boundary

The player ZIP contains only runtime configuration, the Mod script, localized strings, English and Chinese player documentation, proprietary license files, and one self-contained NativeAOT executable. Source projects, test tools, Node.js, the .NET SDK and Visual Studio are not included.
The Linux server is built and deployed separately from `server/` and `src/MultiplayerRoomServer/`.
