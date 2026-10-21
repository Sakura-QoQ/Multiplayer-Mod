# Room server

Independent TypeScript/Node.js server; development requires Node.js >=22.18 and npm. Production runs as a Linux x64 executable without Node.js, npm or .NET.

```bash
npm ci
npm test
npm run build
npm start
```

`npm run build:release` runs on Linux x64 and creates **dist/FallenFlowerServer** using esbuild and Node.js SEA, with embedded dependencies/version metadata and adjacent license notices. GitHub Actions builds on Ubuntu 22.04 using Node.js 22.23.3.

GitHub Actions builds/tests this directory on Ubuntu, checks real TCP ping/pong, renames it to FallenFlowerServer, uploads it to `/opt/FallenFlowerServer`, and activates that directory using `systemctl`. Configuration remains at `/opt/FallenFlowerServer/.env`. The host needs Linux x64 with glibc >=2.28 and systemd. It does not need Node.js or npm. Set systemd `ExecStart=/opt/FallenFlowerServer/FallenFlowerServer`; old npm units are rejected before stopping the service. Failed activation restores the previous dist; successful activation deletes temporary rollback/upload directories.

The systemd service is `fallen-flower-room.service`. Create it manually using the deployment account (the setup example uses ubuntu). First-time uploads are made visible at the application root before the missing configuration/unit is reported; existing deployments are preserved when prerequisites are missing. [Initial setup, SSH configuration and commands](README.zh-CN.md).

Rooms and calendars are in memory and reset on restart. Native calendar catch-up can expire personal timed quests; saves stay local. Transport remains plaintext framed TCP.
