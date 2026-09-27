# Game Mod source layout

This directory is the editable source for the in-game Mod. `build.ps1` concatenates the files in
`source-order.json` into `mod/main.ts` because UcModLauncher loads one script entry and does not
resolve TypeScript modules. The generated file must not be edited directly.

- `core/`: shared protocol types, constants, state and runtime helpers.
- `network/bridge/`: IPC state snapshots and bundled bridge process communication.
- `network/control/`: hosting, joining and the main network update loop.
- `network/events/`: incoming packet routing.
- `network/`: configuration, message transport, validation and authoritative world time.
- `player/avatar/`: remote model creation, materials, clothing and bone mapping.
- `player/info/`: player-information presentation models.
- `player/profile/`: profile reading, storage and chunked transmission.
- `player/state/`: frequent transform/action snapshots and per-frame remote rendering.
- `save/`: online-save entry, redirection, protection and exit-save flow.
- `ui/components/`: reusable Unity UI primitives. Pages construct controls through these helpers.
- `ui/pages/`: main-menu connection settings, the read-only pause-menu room page and player lists.
- `ui/i18n/<language>/strings.json`: UI translations, organized by language abbreviation.
- `hooks/`: the only game-hook registration and startup entry.
- `diagnostics/`: dual-instance verification behavior; inactive on the default channel.

When adding a module, also add it to `source-order.json` after every file that declares symbols it
uses. Runtime language files are copied to `mod/i18n` during the build.
