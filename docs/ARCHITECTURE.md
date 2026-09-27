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
    GameA --> SaveA[MPOnline UUIDv7 save]
    GameB --> SaveB[MPOnline UUIDv7 save]
```

- `src/GameMod/` owns Unity UI, hooks, save lifecycle, online time presentation and player/profile synchronization.
- `src/MultiplayerBridge/` contains direct TCP and the dedicated-room client adapter with bounded queues.
- `src/MultiplayerBridgeHost/` owns process lifecycle, log-command IPC, rotating state snapshots, endpoint decoding and save cryptography.
- `src/MultiplayerRoomServer/` owns public membership, clock/scene/sleep control and packet relay.
- `mod/main.ts` and `mod/i18n/` are generated runtime copies; edit `src/GameMod/` instead.

The bridge launches as the current user without registry IPC or elevation. Game-to-bridge commands are marked single-line records in Unity `Player.log`. Bridge-to-game state uses three rotating JSON snapshots so the Jint reader does not race the writer.

## Authority and synchronization

| Data | Public-room authority | Frequency/path |
| --- | --- | --- |
| Membership and authenticated peer ID | Ubuntu server | Connection lifecycle |
| Position, rotation, action, weapon, Animator layers | Owning player | 20 Hz snapshot; render-frame interpolation |
| Clothing, customization, complete profile snapshot | Owning player | Revisioned 2 s profile update; chunked when required |
| Health, stamina, money, day/time display and scene | Owning player | 0.5 s live-data update |
| Detailed day/time/offset | Each game client | Native game flow; the public server never writes a clock value |
| Room scene | Ubuntu server peer `0` | Compare-and-swap request/broadcast |
| Sleep advancement | Ubuntu server peer `0` + every client | Server approves unanimous matching requests; every client applies the same transition |
| Online save | Local player computer | UUIDv7 file; never sent to the room server as a file |

The server validates the room envelope and authenticated member identity. For public traffic it replaces player-owned IDs/names and handles scene/sleep control packets. It intentionally drops legacy `worldTime`, `serverTimeSeed`, and `serverTimeCommit` packets and never broadcasts a detailed clock. Each client therefore keeps the game's native time flow and story-driven `AddTime/AddDay` results. A unanimous sleep request—including a single member in a one-player room—is approved by the server, then every current client applies the same transition. The server does not simulate Unity physics, combat, quests or inventory.

Profile transfer is for remote appearance and player-information views. Receiving another player's complete profile does not apply that progress to the local save.

## Room lifecycle

1. The server permanently maintains `public-1`; `room.list` returns actual rooms with live population and server-defined capacity even after every player leaves.
2. `room.enter` joins the selected listed room without a password; public capacity is never supplied by a client.
3. The server remains logical peer `0`; every player receives the smallest available positive member ID. A departed member's ID is immediately reusable, including ID `1`.
4. When all public rooms are full the server creates the next numbered room. Redundant empty rooms are reclaimed while one joinable empty room is retained.
5. `room.create`/`room.join` remain available for explicit rooms and compatibility clients; the in-game local Host/Join page instead uses direct `BridgeNode` TCP.
6. Direct mode retains player-host authority and may require inbound networking; public mode never grants authority to a player.
7. No standalone heartbeat is sent. Existing public TCP frames refresh activity; five minutes without a complete client frame closes the socket and routes cleanup through `LeaveRoomAsync`, releasing membership and the reusable ID.
8. Independently, five minutes without at least 0.05 units of accumulated world-position movement or a scene change is treated as AFK, even if stationary position packets continue arriving.

Frames are a four-byte big-endian length followed by UTF-8 JSON, with a 64 KiB frame limit. The transport is plain TCP, not TLS. AES-GCM endpoint obfuscation only hides editable configuration; it does not secure packets on the wire.

## Save transaction

```mermaid
sequenceDiagram
    participant G as Game Mod
    participant B as Bridge
    participant D as Save directory
    G->>B: prepareSave(MPOnline UUID)
    B->>D: authenticate/decrypt MPOnline
    B->>D: create temporary MPActive
    Note over G,B: write gates remain disabled
    G->>G: LoadGame(MPActive)
    G->>B: releaseSave
    B->>D: delete MPActive
    G->>B: enableSaveWrites
    B->>D: preserve byte-exact offline AutoSave baseline
    G->>D: unhookable native writer writes hard-coded AutoSave
    B->>D: capture complete AutoSave into MPActive
    B->>D: validate HMAC / decrypt / parse JSON
    B->>D: atomically replace MPOnline
    B->>D: delete MPActive after success
    G->>B: bed Save Game commits GetSave JSON
    B->>D: atomically replace MPOnline
```

Only `MPOnline_<UUIDv7>.save` persists normally. `MPActive` exists solely because the game cannot read the Mod's authenticated outer container. During preparation and loading, both the game script and bridge reject writes. If loading fails, the formal online file remains byte-for-byte unchanged.

`GameManager` is absent from the launcher's `@hookable` type list, so `AutoSaving/SaveGame` hooks are not a valid boundary. The bridge durably protects the offline `AutoSave` baseline, captures a new hard-coded native `AutoSave` through `MPActive`, validates HMAC/decryption/JSON and the outer container, atomically replaces `MPOnline`, deletes `MPActive`, and restores the offline bytes. Startup completes the same recovery after an interrupted process.

Pause-menu Exit keeps the game's original behavior. If native exit invokes AutoSave, it uses the same
validated two-phase commit. Bridge shutdown retries a valid writable-stage `MPActive`; a partially initialized
or invalid file cannot replace the formal file.

## Source assembly

UcModLauncher loads one Jint script and does not resolve TypeScript modules. `build.ps1` verifies that `src/GameMod/source-order.json` lists every `.ts` file exactly once, concatenates the files into `mod/main.ts`, checks page/component boundaries, and verifies identical translation keys across six languages.
