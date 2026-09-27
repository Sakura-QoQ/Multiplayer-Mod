# Fallen Flower room server

Public-room authority and relay for PlayerHostedMultiplayer. It owns membership, logical peer `0`, the 5 Hz room clock, scene arbitration and unanimous sleep approval. It does not run the game, read player saves or simulate Unity gameplay.

> The protocol is framed JSON over plain TCP, not TLS. Restrict administration, use a unique random admin token, and place a secure transport proxy in front of the service if confidentiality is required.

## Deploy

Requirements: an Ubuntu/Linux Docker host, Docker Engine with Compose, and inbound TCP access to the configured port (`27777` by default). The host does not need .NET or Node.js.

From the repository root:

```bash
cd server
cp .env.example .env
nano .env
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100 room-server
```

A healthy service shows:

```text
Fallen Flower room server listening on 0.0.0.0:27777
```

Open TCP 27777 in the cloud security group. If UFW is active:

```bash
sudo ufw allow 27777/tcp
```

From Windows:

```powershell
Test-NetConnection <server-address> -Port 27777
```

## Automatic deployment with GitHub Actions

`.github/workflows/deploy-server.yml` deploys server-side changes from `main` and can also be run manually. It connects to the Ubuntu host over SSH; the host clones the private `Sakura-QoQ/Multiplayer-Mod-Dev` repository on first use and checks out the exact workflow commit thereafter. The deployment validates Compose configuration, stops the old stack, rebuilds the image, starts a fresh container and verifies that it is running.

Use a dedicated unprivileged `deploy` account that owns `/opt/Multiplayer-Mod` and can run `docker compose` directly. Configure separate credentials for Actions-to-server SSH and a read-only repository Deploy Key for server-to-GitHub access. Add these values to the GitHub `production` Environment:

| Name | Kind | Value |
| --- | --- | --- |
| `DEPLOY_SSH_HOST` | Secret | Ubuntu host name or IP address |
| `DEPLOY_SSH_USER` | Secret | Deployment account, normally `deploy` |
| `DEPLOY_SSH_PRIVATE_KEY` | Secret | Private key used by Actions to log in |
| `DEPLOY_SSH_KNOWN_HOSTS` | Secret | Verified SSH host-key line for the server |
| `DEPLOY_SSH_PORT` | Variable, optional | SSH port; defaults to `22` |

The first run clones the repository and then stops safely if `server/.env` is absent. Create `/opt/Multiplayer-Mod/server/.env` on the host and rerun the workflow. Git ignores this file, so subsequent source resets and `git clean -fd` preserve it.

## Configure

| Variable | Default | Valid range/purpose |
| --- | --- | --- |
| `FF_ROOM_PORT` | `27777` | TCP port, 1–65535 |
| `FF_ROOM_MAX_ROOMS` | `256` | In-memory room limit, 1–10,000 |
| `FF_ROOM_MAX_PLAYERS` | `8` | Players per room, 2–32 |
| `FF_ROOM_CLIENT_TIMEOUT_SECONDS` | `300` | Disconnect after this many seconds without a complete incoming TCP frame, 3–3,600 |
| `FF_ROOM_AFK_TIMEOUT_SECONDS` | `300` | Disconnect after this many seconds without effective position movement or a scene change, 3–3,600 |
| `FF_ROOM_DAY_LENGTH_SECONDS` | `3600` | Real seconds per complete game day, 60–86,400 |
| `FF_ROOM_ADMIN_TOKEN` | empty | Enables all `admin.*` commands; minimum 16 characters |

Generate a token with `openssl rand -hex 32`. An empty token disables remote administration. Do not commit `.env`; it is ignored by Git and excluded from update archives.

Invalid values cause exit code 1 and, with `restart: unless-stopped`, a restart loop. Check `docker compose logs` for the exact validation message.

## Update safely

Run Git as the repository owner, not alternately as `root` and `ubuntu`. If `/opt/Multiplayer-Mod` is currently root-owned, correct it once:

```bash
sudo chown -R ubuntu:ubuntu /opt/Multiplayer-Mod
```

Then update while preserving `.env`:

```bash
cd /opt/Multiplayer-Mod
cp server/.env /tmp/fallen-flower-server.env
git pull --ff-only
cp /tmp/fallen-flower-server.env server/.env
cd server
sudo docker compose up -d --build --force-recreate
sudo docker compose ps
sudo docker compose logs --tail=100 room-server
```

Do not solve `dubious ownership` by globally trusting arbitrary paths. Consistent ownership avoids both that warning and `.env` permission failures. A fresh clone is also valid; copy the existing `.env` into the new `server/` directory before replacing the running Compose project.

## Protocol and room behavior

Each frame is a four-byte big-endian length followed by UTF-8 JSON, maximum 64 KiB. Supported commands are:

- `ping`
- `room.list`, `room.create`, `room.join`, `room.enter`, `room.info`, `room.send`
- `admin.stats`, `admin.room.kick`, `admin.room.close`, `admin.room.send`

The server creates one real public room at startup. `room.list` returns only actual server-managed rooms with live population/capacity. When every room reaches `FF_ROOM_MAX_PLAYERS`, the server creates the next numbered room; redundant empty rooms are reclaimed. `room.enter` joins a listed room without a password and never accepts capacity from a client. Public players receive the smallest available positive ID and `authorityPeerId: 0`; released IDs are reused and the first entrant is not an authority player.

No standalone heartbeat is sent. Every existing game/control frame refreshes connection activity. If no complete frame arrives for five minutes by default, the server closes that stale socket; the connection handler then runs the same `LeaveRoomAsync` cleanup used for a normal exit, broadcasts `room.playerLeft`, and releases the member ID.

AFK is tracked separately from TCP activity. Repeated packets at the same location do not keep a slot indefinitely: five minutes without at least 0.05 units of accumulated world-position movement or a scene change closes the connection through the same cleanup path.

For public rooms, the server parses control packet types, replaces player-owned IDs/names with authenticated connection values, rejects player clock authority, and coordinates time/scene/sleep. The native four time periods are distributed evenly across `FF_ROOM_DAY_LENGTH_SECONDS`. A one-player room can approve sleep immediately; “sleep until tomorrow” advances the authoritative clock to the next day before approval is broadcast, without accepting a client time commit. Profile contents remain client-managed. The server always retains one joinable empty room when capacity allows.

Explicit `room.create`/`room.join` rooms retain creator authority for protocol compatibility and close when that authority leaves.

## Container boundary

The runtime image uses Ubuntu Chiseled .NET 8, a non-root user, no Linux capabilities, a read-only root filesystem and `no-new-privileges`. Room state is memory-only; replacing or restarting the container clears instantiated rooms, clock and roster state.

## Troubleshoot

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `Restarting (1)` | Invalid environment value | Read logs; check player range 2–32 and token length |
| TCP test fails | Cloud firewall, UFW or Compose port | Open TCP and confirm `0.0.0.0:27777->27777/tcp` |
| `unknown command` | Old server image | Pull the matching source and rebuild without relying on cache |
| Public room full | Capacity reached | Select another room or raise `FF_ROOM_MAX_PLAYERS` and restart |
| A disconnected player remains temporarily | TCP inactivity timeout has not elapsed | Wait up to `FF_ROOM_CLIENT_TIMEOUT_SECONDS` (default 300); the server then releases the member and ID automatically |
| A stationary player is removed | AFK timeout elapsed | Move at least 0.05 world units or change scene before `FF_ROOM_AFK_TIMEOUT_SECONDS` expires |
| `dubious ownership` or `.env` permission denied | Mixed repository ownership | Make one deployment user own `/opt/Multiplayer-Mod` |
| Players connect but cannot agree on behavior | Version mismatch | Match server, Mod and game versions |
