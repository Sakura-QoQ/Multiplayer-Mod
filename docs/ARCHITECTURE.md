# Architecture

The project has two network paths: production public rooms through an Ubuntu authority/relay, and retained local direct Host/Join. Both use the bundled Windows bridge; neither injects a DLL into the game.

## Runtime components

```mermaid
flowchart LR
    GameA[Game + Jint Mod] -->|marked Player.log commands| BridgeA[NativeAOT bridge]
    BridgeA -->|rotating state JSON| GameA
    GameB[Game + Jint Mod] -->|marked Player.log commands| BridgeB[NativeAOT bridge]
    BridgeB -->|rotating state JSON| GameB
    BridgeA <-->|plain framed TCP| Server[Ubuntu room authority]
    BridgeB <-->|plain framed TCP| Server
    GameA --> SaveA[Native default AutoSave]
    GameB --> SaveB[Native default AutoSave]
```

- `src/GameMod/` owns Unity UI, hooks, save lifecycle, online time presentation and player/profile synchronization.
- `src/MultiplayerBridge/` contains direct TCP and the dedicated-room client adapter with bounded queues.
- `src/MultiplayerBridgeHost/` owns process lifecycle, log-command IPC, rotating state snapshots and endpoint decoding; it never touches save files.
- `src/MultiplayerRoomServer/` owns public membership, scene/sleep control and packet relay.
- `mod/main.ts` and `mod/i18n/` are generated runtime copies; edit `src/GameMod/` instead.

The bridge launches as the current user without registry IPC or elevation. Each game process uses an isolated `game-<PID>` channel, mutex, IPC marker, and state snapshots, so multiple games on one machine cannot consume one another's room commands. Game-to-bridge commands are marked single-line records in Unity `Player.log`. Bridge-to-game state uses three rotating JSON snapshots so the Jint reader does not race the writer.

## Authority and synchronization

| Data | Public-room authority | Frequency/path |
| --- | --- | --- |
| Membership and authenticated peer ID | Ubuntu server | Connection lifecycle |
| Position, rotation, action, weapon, Animator layers | Owning player | 20 Hz snapshot; render-frame interpolation |
| Clothing, customization, aggregate profile statistics | Owning player | Revisioned 2 s profile update; chunked when required |
| Health, stamina, money, day/time display and scene | Owning player | 0.5 s live-data update |
| Detailed day/time/offset | Each game client | Native game flow; the public server never writes a clock value |
| Room scene | Ubuntu server peer `0` | Compare-and-swap request/broadcast |
| Sleep advancement | Ubuntu server peer `0` + every client | Server approves unanimous matching requests; every client applies the same transition |
| Player save | Local player computer | Native default `AutoSave`; never sent to the room server as a file |

The server validates the room envelope and authenticated member identity, replacing client-claimed IDs and names. Ordinary players may send only whitelisted self-owned state/profile/chunk packets plus sleep and scene requests; they cannot forge `welcome`, roster, leave, server-scene or sleep-approval packets. Legacy clock packets are dropped and the server never broadcasts a detailed clock. The Mod never writes `timeScale`, `gameTime`, `timeOffset`, or the story day, preserving native `SetTime/AddTime/AddDay` transactions. A unanimous sleep request—including the sole real member of a one-player room—is approved, then every current client executes the original bed transition.

Profile transfer contains only remote appearance, live state and aggregate progress counts. Full story/contact/save data is not broadcast and remote progress is never applied to the local save.

## Room lifecycle

1. The server permanently maintains `public-1`; `room.list` returns actual rooms with live population and server-defined capacity even after every player leaves.
2. `room.enter` joins the selected listed room without a password; public capacity is never supplied by a client.
3. The server embeds its independent `server/version.json`, which separately declares `serverVersion` and `requiredModVersion`; it never reads the player package's `mod/info.json`. `room.list` advertises both server and required Mod versions, and version-aware clients submit `modVersion` on entry. A mismatch returns business code `2012` with HTTP-style status `426`, which the Mod presents as an update prompt before loading a save.
4. The server remains logical peer `0`; every player receives the smallest available positive member ID. A departed member's ID is immediately reusable, including ID `1`.
5. When all public rooms are full the server creates the next numbered room. Redundant empty rooms are reclaimed while one joinable empty room is retained.
6. `room.create`/`room.join` remain available for explicit rooms and compatibility clients; the in-game local Host/Join page instead uses direct `BridgeNode` TCP.
7. Direct mode retains player-host authority and may require inbound networking; public mode never grants authority to a player.
8. No standalone heartbeat is sent. Existing public TCP frames refresh activity; five minutes without a complete client frame closes the socket and routes cleanup through `LeaveRoomAsync`, releasing membership and the reusable ID.
9. Independently, five minutes without at least 0.05 units of accumulated world-position movement or a scene change is treated as AFK, even if stationary position packets continue arriving.

Frames are a four-byte big-endian length followed by UTF-8 JSON, with a 64 KiB frame limit. The transport is plain TCP, not TLS. AES-GCM endpoint obfuscation only hides editable configuration; it does not secure packets on the wire.

## Save behavior

After entering a room, the Mod invokes the original Load Game initializer and the game's actual `LoadSaveWindow.ExecuteLoad("AutoSave")`, then hides the picker in the same frame before the Canvas can render it. The newer game's `Load` method only opens a confirmation prompt, so waiting on that hidden prompt would never start loading. `LoadSaveWindow` still owns the complete transaction; the Mod does not call `StartGame` or `GameManager.LoadGame` and does not enable synchronization or saving until native callbacks settle. Automatic saves, bed saves, pause-menu controls and exit preserve the resulting `GameManager.SaveName`. The bridge is network-only.

Legacy `MPOnline`/`MPActive` files are left on disk for manual recovery, but the current release does not list, read or write them. Multiplayer and single-player changes to the native default slot are visible to each other by design.

## Source assembly

UcModLauncher loads one Jint script and does not resolve TypeScript modules. `tools/Build-Mod.ps1` verifies that `src/GameMod/source-order.json` lists every `.ts` file exactly once, concatenates the files into `mod/main.ts`, checks page/component boundaries, and verifies identical translation keys across six languages.
