# Game Mod source layout

This directory is the editable source for the in-game Mod. `build.ps1` concatenates the files in
`source-order.json` into `mod/main.ts` because UcModLauncher loads one script entry and does not
resolve TypeScript modules. The generated file must not be edited directly.

The production path is public-server mode: the three fixed buttons start `RoomRelayClient` through the
bundled bridge, and all peers connect outbound to the Ubuntu room server. Address, room-ID, password
and direct host/join controls are not exposed in the player UI.

- `core/`: shared protocol types, constants, state and runtime helpers.
- `network/bridge/`: IPC state snapshots and bundled bridge process communication.
- `network/control/`: public-room session control, retained transport compatibility and the main update loop.
- `network/events/`: incoming packet routing.
- `network/`: configuration, message transport, validation and server-authoritative world time/scene handling.
- `player/avatar/`: remote model creation, materials, clothing and bone mapping.
- `player/info/`: player-information presentation models.
- `player/profile/`: profile reading, storage and chunked transmission.
- `player/state/`: frequent transform/action snapshots and per-frame remote rendering.
- `save/`: online-save entry, redirection, protection and exit-save flow.
- `ui/components/`: reusable Unity UI primitives. Pages construct controls through these helpers.
- `ui/pages/`: one-click public-server selection, read-only pause room page and player lists.
- `ui/i18n/<language>/strings.json`: UI translations, organized by language abbreviation.
- `hooks/`: the only game-hook registration and startup entry.
- `diagnostics/`: dual-instance verification behavior; inactive on the default channel.

When adding a module, also add it to `source-order.json` after every file that declares symbols it
uses. Runtime language files are copied to `mod/i18n` during the build.
