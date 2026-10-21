# Room server

Independent TypeScript/Node.js server; requires Node.js >=22.18 and npm.

```bash
npm ci
npm test
npm run build
npm start
```

`npm run build:release` prepares a standalone **dist/** directory containing compiled JavaScript, runtime package/lock files, version metadata, licenses and production npm dependencies.

GitHub Actions builds/tests this directory on Ubuntu, checks real TCP ping/pong, renames it to FallenFlowerServer, uploads it to `/opt/FallenFlowerServer`, and activates that directory using `systemctl`. Configuration remains at `/opt/FallenFlowerServer/.env`. The host does not compile, install npm dependencies, pull source or build Docker images. Failed activation restores the previous dist; successful activation deletes temporary rollback/upload directories.

The systemd service is `fallen-flower-room.service`, running as deploy. Install the updated unit before migrating from an old deployment path. [Initial setup, SSH configuration and commands](README.zh-CN.md).

Rooms and calendars are in memory and reset on restart. Native calendar catch-up can expire personal timed quests; saves stay local. Transport remains plaintext framed TCP.
