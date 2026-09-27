# Game Mod source layout

This directory is the editable source for the in-game Mod. `build.ps1` concatenates the files in
`source-order.json` into `mod/main.ts` because UcModLauncher loads one script entry and does not
resolve TypeScript modules. The generated file must not be edited directly.

The main page keeps local direct Host/Join. Public servers requests the server-managed real room list
and live population/capacity through the bundled bridge before the player selects a room. The public
endpoint stays hidden from editable UI configuration. Public capacity is never supplied by the client;
`localMaxPlayers` applies only to local direct hosting.

- `core/`: shared protocol types, constants, state and runtime helpers.
- `network/bridge/`: IPC state snapshots and bundled bridge process communication.
- `network/control/`: public-room session control, retained transport compatibility and the main update loop.
- `network/events/`: incoming packet routing.
- `network/`: configuration, message transport, validation and server-authoritative world time/scene handling.
- `player/avatar/`: remote model creation, materials, clothing and bone mapping.
- `player/info/`: player-information presentation models.
- `player/profile/`: profile reading, storage and chunked transmission.
- `player/state/`: frequent transform/action snapshots and per-frame remote rendering.
- `save/`: UUIDv7 entry, read-only load transaction, temporary load-copy release, direct `MPOnline` commits and verified exit.
- `ui/components/`: reusable Unity UI primitives. Pages construct controls through these helpers.
- `ui/pages/`: local Host/Join, public-room browser, read-only pause room page and player lists.
- `ui/i18n/<language>/strings.json`: UI translations, organized by language abbreviation.
- `hooks/`: the only game-hook registration and startup entry.
- `diagnostics/`: dual-instance verification behavior; inactive on the default channel.

When adding a module, also add it to `source-order.json` after every file that declares symbols it
uses. Runtime language files are copied to `mod/i18n` during the build.

Online `SaveGame("AutoSave")` is intercepted only while `role !== "off"`: the original disk writer
is cancelled and the in-memory snapshot is committed to `MPOnline`. Single-player mode returns from
the Hook without interception. Do not reintroduce bridge-side `AutoSave.save` monitoring.
