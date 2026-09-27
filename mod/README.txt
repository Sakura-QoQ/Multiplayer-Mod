Fallen Flower Multiplayer — Public Server Edition v0.13.0 — Windows x64

INSTALL
1. Import this package with the game's Mod launcher.
2. Start the game through that launcher; no separate script is required.
3. Select Multiplayer above New Game.

The package includes a self-contained MultiplayerBridgeHost.exe. Players do not install .NET,
Node.js, TypeScript, Visual Studio or other development software. The bridge runs as the current
user without administrator elevation or registry IPC.
It does not install services, run an installer, use registry-backed preferences or download software.

PLAY
- Public servers shows the real server-managed room list with live population/capacity. The server
  starts with one room, adds another only when all rooms are full, and reclaims redundant empty rooms.
  Choose a listed room without entering an address or password. Players need outbound TCP only.
- Public capacity comes only from FF_ROOM_MAX_PLAYERS. localMaxPlayers applies only to local hosting.
- Local Host/Join remains available with address/port controls. A direct public host may need an
  inbound firewall rule and router forwarding.
- The Ubuntu service is logical authority peer 0. Every public player, including the first one,
  is an ordinary positive-ID member.
- Hold Tab in an online game for the centered player list. The pause-menu Multiplayer page is
  read-only; the world and synchronized clock continue behind it.

SYNC
Player transform/action snapshots use 20 Hz; remote transforms, Animator layers and clothing bones
update every frame. Clothing, skin tan, customization, complete profile snapshots and live status
are transferred for remote appearance/information. Another player's progress is never merged into
your save. The server sends a 5 Hz authoritative clock and approves sleep only after every connected
player requests the same mode.

SAVES
Only MPOnline_<UUIDv7>.save persists normally. MPActive_<UUIDv7>.save is created temporarily so the
game can load its native encrypted format, then deleted. Loading is read-only until it completes.
Online autosave cancels the original SaveGame("AutoSave") disk write and commits the in-memory
GetSave() state directly to MPOnline. The online pipeline does not read or write single-player
AutoSave.save. Use the native-style Save game option at a bed for an explicit online save. Exit keeps
the game's original behavior and does not save or block quitting.

SECURITY
Save files are double-encrypted at rest. Network traffic is framed JSON over plain TCP, not TLS.
The embedded endpoint is obfuscated, not secret. Do not assume save encryption protects packets.

LANGUAGES
English, Japanese, Simplified Chinese, Traditional Chinese, Korean and Spanish follow the game's
current language. See README.zh-CN.txt for Chinese help and LICENSE for the governing terms.
