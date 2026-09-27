# Fallen Flower Room Server

Dockerized room-control and relay service for PlayerHostedMultiplayer. The server does not run the game, read saves, simulate the world, or parse player state. It manages rooms and forwards opaque payloads only.

Rooms have no player host. The creator and every later participant are equal members with positive peer IDs. Only the server can kick members, close rooms, or issue server messages through authenticated `admin.*` commands. A room remains registered even when its member count reaches zero.

## Requirements

- Ubuntu or another Linux host supported by Docker
- Docker Engine with the Compose plugin
- An inbound TCP firewall rule for the configured port, `27777` by default

No .NET SDK, .NET runtime, Node.js, or Windows build tools are required on the host.

## Start

Copy the project to the server, enter the `server` directory, and run:

```bash
cp .env.example .env
docker compose up -d --build
```

Check status and logs:

```bash
docker compose ps
docker compose logs -f room-server
```

Stop or update:

```bash
docker compose down
docker compose up -d --build
```

## Configuration

Edit `server/.env` before starting the container:

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `FF_ROOM_PORT` | `27777` | Public TCP port and container listening port |
| `FF_ROOM_MAX_ROOMS` | `256` | Maximum simultaneous rooms |
| `FF_ROOM_MAX_PLAYERS` | `8` | Maximum players in one room |
| `FF_ROOM_ADMIN_TOKEN` | empty | Enables `admin.stats`; use at least 16 random characters |

Do not commit `.env`; it is excluded by the project `.gitignore`.

## Container security

The final image uses the shell-less Ubuntu chiseled .NET runtime, runs as a non-root user, has all Linux capabilities removed, uses a read-only filesystem, and enables `no-new-privileges`. Room state stays in server memory for the lifetime of the container. Empty rooms remain available, but restarting or replacing the container clears them.

## Protocol

Each message is a four-byte big-endian payload length followed by UTF-8 JSON. The maximum frame size is 64 KiB.

Supported commands:

- `ping`
- `room.list`
- `room.create`
- `room.join`
- `room.info`
- `room.send`
- `admin.stats`
- `admin.room.kick`
- `admin.room.close`
- `admin.room.send`

`room.send` contains an opaque string. The server does not inspect game packets.

Client room messages cannot perform administrative actions. All administrative commands require `FF_ROOM_ADMIN_TOKEN`; if the token is empty, remote administration is disabled. Rooms are never removed because they are empty or idle; they close only through `admin.room.close` or when the server process stops.

This protocol is separate from the current direct player-hosted transport. The Mod still needs a dedicated-server client mode before players can connect through this container.
