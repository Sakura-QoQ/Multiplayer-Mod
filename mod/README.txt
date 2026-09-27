PlayerHostedMultiplayer v0.9.0 — Windows x64

INSTALLATION
1. Import this package with the game's dedicated Mod launcher.
2. Start the game through the Mod launcher. No separate start script is required.
3. Select Multiplayer above New Game on the main menu.

The package includes the self-contained MultiplayerBridgeHost.exe and all runtime dependencies.
Players do not need .NET, Node.js, TypeScript, Visual Studio or other development software.

HOSTING
- Host and Enter resumes your existing UUIDv7 online save.
- A clean online save is created only when no online save exists.
- LAN players connect to the host PC's LAN IPv4 and configured TCP port.
- Internet hosting normally requires a Windows Firewall rule and router port forwarding, or a trusted virtual-LAN tool.

SYNCHRONIZATION
The Mod synchronizes player models, position, rotation, actions, all Animator layers, clothing,
skin tan, customization, complete save-profile data, live status, scenes and host-authoritative time.
Network snapshots are sent at 5 Hz and rendered smoothly every frame. Time advances through sleep
only when every connected player agrees on the same sleep mode.

SAVES
Online saves are named MPOnline_<player UUIDv7>.save. MPActive_<player UUIDv7>.save is the retained
recovery copy. Both are hidden from the original single-player save UI. Exiting online mode saves
and verifies the double-encrypted online file before quitting, without overwriting AutoSave files.

LANGUAGES
The in-game UI follows the game's current language. Available language packs: English, Japanese,
Simplified Chinese, Traditional Chinese, Korean and Spanish.

See README.zh-CN.txt for Simplified Chinese documentation.
This package is proprietary software. See LICENSE for the governing terms.
