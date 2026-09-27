# Fallen Flower dedicated room server

Required Docker public-room relay for PlayerHostedMultiplayer v0.11.0. The server does not run the game, read saves, simulate the world, or parse player state. It manages rooms and forwards opaque payloads only.

The service is logical authority peer `0`. It owns membership, the 5 Hz room clock, scene arbitration, unanimous sleep approval and moderation. Every player is an ordinary positive-ID member; one player leaving never grants authority to another or closes the public room.

## Requirements

- Ubuntu or another Linux host supported by Docker
- Docker Engine with the Compose plugin
- An inbound TCP firewall rule for the configured port, `27777` by default

No .NET SDK, .NET runtime, Node.js, or Windows build tools are required on the host.

## Quick start

Copy the project to the server, enter the `server` directory, and run:

```bash
cp .env.example .env
nano .env
sudo docker compose up -d --build
```

Check status and logs:

```bash
sudo docker compose ps
sudo docker compose logs --tail=100 room-server
```

Stop or update:

```bash
sudo docker compose down
sudo docker compose up -d --build --force-recreate
```

## Configuration

Edit `server/.env` before starting the container:

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `FF_ROOM_PORT` | `27777` | Public TCP port and container listening port |
| `FF_ROOM_MAX_ROOMS` | `256` | Maximum simultaneous rooms |
| `FF_ROOM_MAX_PLAYERS` | `8` | Maximum players in one room |
| `FF_ROOM_ADMIN_TOKEN` | empty | Enables all `admin.*` commands; use at least 16 random characters |

Do not commit `.env`; it is excluded by the project `.gitignore`.

Generate a suitable administrator token with `openssl rand -hex 32`. `FF_ROOM_MAX_PLAYERS` must be
between `2` and `32`; values outside that range cause the container to restart with exit code 1.

## Network access

Open the configured TCP port in the cloud firewall/security group. If UFW is active, also run:

```bash
sudo ufw allow 27777/tcp
```

Verify from a Windows player computer:

```powershell
Test-NetConnection 3.10.232.221 -Port 27777
```

`TcpTestSucceeded : True` proves TCP reachability. A healthy container additionally logs:

```text
Fallen Flower room server listening on 0.0.0.0:27777
```

## Update v0.11.0

The server update archive preserves the existing `server/.env` because the archive does not contain
that file. After uploading it to `/tmp`:

```bash
sudo unzip -o /tmp/FallenFlowerRoomServer-v0.11.0-source.zip -d /opt
cd /opt/Multiplayer-Mod/server
sudo docker compose up -d --build --force-recreate
sudo docker compose ps
sudo docker compose logs --tail=100 room-server
```

After the v0.11.0 server is running, players only enter a name and select Public Server 1, 2 or 3.
The endpoint and fixed room IDs are built into the Mod; public rooms do not use passwords.

## Container security

The final image uses the shell-less Ubuntu chiseled .NET runtime, runs as a non-root user, has all Linux capabilities removed, uses a read-only filesystem, and enables `no-new-privileges`. Room state stays in server memory; restarting or replacing the container clears it.

## Room lifecycle and protocol

Each message is a four-byte big-endian payload length followed by UTF-8 JSON. The maximum frame size is 64 KiB.

Supported commands:

- `ping`
- `room.list`
- `room.create`
- `room.join`
- `room.enter` (atomic create-or-join used by the public-server buttons)
- `room.info`
- `room.send`
- `admin.stats`
- `admin.room.kick`
- `admin.room.close`
- `admin.room.send`

`room.send` contains an opaque string. The server does not inspect game packets.

Client room messages cannot perform administrative actions. All administrative commands require `FF_ROOM_ADMIN_TOKEN`; if the token is empty, remote administration is disabled. Public rooms close only through `admin.room.close` or when the server process stops; empty rooms remain available.

The server assigns positive player IDs and returns `authorityPeerId: 0` plus `serverAuthority: true`
in `room.ready`. It replaces `ownerId` in player state/profile packets with the authenticated connection ID.

## Troubleshooting

| Symptom | Cause | Action |
| --- | --- | --- |
| Container shows `Restarting (1)` | Invalid configuration | Run `docker compose logs`; ensure `FF_ROOM_MAX_PLAYERS` is 2–32 |
| TCP test fails | Cloud firewall or port mapping | Open TCP 27777 and confirm Compose publishes `0.0.0.0:27777->27777/tcp` |
| Mod reports `unknown command` | Server is older than v0.11.0 | Upload this server source and rebuild the container |
| Public room is full | The configured per-room limit was reached | Select another public server or increase `FF_ROOM_MAX_PLAYERS` and restart |
| All players disconnect | Network or server interruption | Check the container; ordinary player exits do not close a public room |
