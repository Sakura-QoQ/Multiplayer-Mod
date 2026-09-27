# Verification report — v0.9.0

Verified on 27 September 2026 with two real `FallenFlower.exe` processes and two isolated bridge processes.

## Verified behavior

- Both game processes connected through the machine's LAN adapter address `192.168.37.127`, not a loopback address.
- TCP framing, protocol negotiation, peer assignment and bidirectional messages passed.
- Both processes created remote player models and received full profile and live-status data.
- Non-empty clothing, skin tan, all 182 clothing bones, actions, movement and cross-scene following passed.
- The online pause menu remained visible while world time continued; the phone window opened normally afterward.
- Host-authoritative world time and unanimous sleep approval passed.
- The two-process test did not change any original `AutoSave*.save` hash.
- The online-save lifecycle created a UUIDv7 file, saved on exit, reopened the same UUID, restored the saved position within collision correction tolerance, preserved the recovery copy, and released its bridge port.
- The bridge save self-test passed encryption round-trip, tamper rejection, UUIDv7 migration, save retention and single-player restoration.
- After testing, no game or bridge process and no test listening port remained.

## Evidence

- Two-process LAN test: `artifacts/dual-instance/20260927-100628/evidence/summary.json`
- Online-save lifecycle: `artifacts/online-save/20260927-100541/evidence/summary.json`

The automated LAN test uses two real game processes on one Windows machine through a physical LAN interface. It proves the two-instance workflow requested for development; it is not a claim that every router, firewall, ISP or physical two-PC configuration has been tested.

## Package boundary

The player ZIP contains only runtime configuration, the Mod script, localized strings, English and Chinese player documentation, proprietary license files, and one self-contained NativeAOT executable. Source projects, test tools, Node.js, the .NET SDK and Visual Studio are not included.
