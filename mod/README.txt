PlayerHostedMultiplayer v0.9.0 — Windows x64

INSTALLATION
1. Import this package with the game's dedicated Mod launcher.
2. Start the game through the Mod launcher. No separate start script is required.
3. Select Multiplayer above New Game on the main menu.

The package includes the self-contained MultiplayerBridgeHost.exe and all runtime dependencies.
Players do not need .NET, Node.js, TypeScript, Visual Studio or other development software.
The bridge runs with normal user rights and does not request administrator elevation. Windows
Defender Firewall may still ask once when this PC accepts inbound players for the first time.

HOSTING
- Host and Enter resumes your existing UUIDv7 online save.
- A clean online save is created only when no online save exists.
- LAN players connect to the host PC's LAN IPv4 and configured TCP port.
- Internet hosting normally requires a Windows Firewall rule and router port forwarding, or a trusted virtual-LAN tool.
- Hold Tab after entering an online game to show the room-player list in the center of the screen.

SYNCHRONIZATION
The Mod synchronizes player models, position, rotation, actions, all Animator layers, clothing,
skin tan, customization, complete save-profile data, live status, scenes and host-authoritative time.
Player movement snapshots are sent at 20 Hz and rendered smoothly every frame. Authoritative world
time remains at 5 Hz. Time advances through sleep
only when every connected player agrees on the same sleep mode.
The Mod owns online time progression. Its unscaled host clock and the world behind the pause menu
continue running while PauseWindow remains visible.

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
