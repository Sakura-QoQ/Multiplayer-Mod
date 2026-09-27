Fallen Flower Multiplayer — Public Server Edition v0.11.0 — Windows x64

INSTALLATION
1. Import this package with the game's dedicated Mod launcher.
2. Start the game through the Mod launcher. No separate start script is required.
3. Select Multiplayer above New Game on the main menu.

The package includes the self-contained MultiplayerBridgeHost.exe and all runtime dependencies.
Players do not need .NET, Node.js, TypeScript, Visual Studio or other development software.
The bridge runs with normal user rights and does not request administrator elevation.
Public-server mode needs outbound TCP access only; players do not open inbound ports.

PUBLIC SERVERS
- Enter a player name and select Public Server 1, 2 or 3. No address, room ID or password is required.
- The room server joins the existing public room or creates it automatically when empty.
- Ubuntu owns membership, the logical authority identity, shared time, scene arbitration and sleep consensus. Every player is an ordinary participant.
- A player leaving removes only that member. The public room remains until an administrator closes it or the service restarts.
- Every player resumes an independent UUIDv7 online save. A clean save is created only when none exists.
- Hold Tab after entering an online game to show the room-player list in the center of the screen.
- The endpoint is AES-GCM encrypted inside the native bridge and is not stored in config.json or the UI.

SYNCHRONIZATION
The Mod synchronizes player models, position, rotation, actions, all Animator layers, clothing,
skin tan, customization, complete save-profile data, live status, server-arbitrated scenes and server-authoritative time.
Player movement snapshots are sent at 20 Hz and rendered smoothly every frame. Server-authoritative world
time remains at 5 Hz. Time advances through sleep
only when every connected player agrees on the same sleep mode.
The server owns online time progression. The synchronized local clock and the world behind the pause menu
continue running while PauseWindow remains visible.
The pause-menu Multiplayer entry is read-only and shows only the role/public-room name, synchronized
time, online count and player list. Hosting and joining controls remain on the main menu.

SAVES
Online saves are named MPOnline_<player UUIDv7>.save. MPActive_<player UUIDv7>.save is the retained
recovery copy. Both are hidden from the original single-player save UI. Exiting online mode saves
and verifies the double-encrypted online file before quitting, without overwriting AutoSave files.

LANGUAGES
The in-game UI follows the game's current language. Available language packs: English, Japanese,
Simplified Chinese, Traditional Chinese, Korean and Spanish.

See README.zh-CN.txt for Simplified Chinese documentation.
See PLAYER_PROFILE_FIELDS.md for the exact save-to-runtime player field map.
This package is proprietary software. See LICENSE for the governing terms.
