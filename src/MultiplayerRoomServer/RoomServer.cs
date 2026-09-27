using System.Collections.Concurrent;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace FallenFlower.MultiplayerRoomServer;

internal sealed partial class RoomServer(ServerOptions options) : IAsyncDisposable
{
    private const int ProtocolVersion = 1;
    private static readonly TimeSpan ClientTimeoutCheckInterval = TimeSpan.FromSeconds(1);
    private readonly ConcurrentDictionary<string, Room> _rooms = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<ClientConnection, byte> _clients = new();
    private readonly object _publicRoomsLock = new();
    private readonly TcpListener _listener = new(options.ListenAddress, options.Port);
    private readonly CancellationTokenSource _shutdown = new();
    private int _nextPublicRoomNumber;

    [GeneratedRegex("^[A-Za-z0-9_-]{3,48}$", RegexOptions.CultureInvariant)]
    private static partial Regex RoomIdPattern();

    public async Task RunAsync()
    {
        // 公开房间是服务器上的真实对象。启动时只建立一个；所有现有房间满员后再扩容。
        if (EnsureJoinablePublicRoom() is null)
            throw new InvalidOperationException("Unable to create the initial public room");
        _listener.Start(512);
        Console.WriteLine($"Fallen Flower room server listening on {options.ListenAddress}:{options.Port}");
        var clockTask = RunAuthoritativeClockAsync(_shutdown.Token);
        var timeoutTask = RunClientTimeoutsAsync(_shutdown.Token);
        try
        {
            while (!_shutdown.IsCancellationRequested)
            {
                var client = await _listener.AcceptTcpClientAsync(_shutdown.Token);
                Configure(client);
                _ = Task.Run(() => HandleClientAsync(client, _shutdown.Token));
            }
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested) { }
        finally
        {
            try { await Task.WhenAll(clockTask, timeoutTask); }
            catch (OperationCanceledException) when (_shutdown.IsCancellationRequested) { }
        }
    }

    public void Stop()
    {
        _shutdown.Cancel();
        _listener.Stop();
    }

    private async Task HandleClientAsync(TcpClient tcpClient, CancellationToken cancellationToken)
    {
        await using var client = new ClientConnection(tcpClient);
        _clients.TryAdd(client, 0);
        try
        {
            var stream = tcpClient.GetStream();
            while (!cancellationToken.IsCancellationRequested)
            {
                using var document = await FrameProtocol.ReadJsonAsync(stream, cancellationToken);
                if (document is null) break;
                client.MarkReceived();
                await HandleMessageAsync(client, document.RootElement, cancellationToken);
            }
        }
        catch (ProtocolException exception)
        {
            await TrySendAsync(client, new { type = "error", code = exception.Code, message = exception.Message }, cancellationToken);
        }
        catch (JsonException)
        {
            await TrySendAsync(client, new { type = "error", code = "invalid_json", message = "invalid JSON" }, cancellationToken);
        }
        catch (Exception exception) when (exception is IOException or SocketException or ObjectDisposedException or OperationCanceledException) { }
        finally
        {
            _clients.TryRemove(client, out _);
            await LeaveRoomAsync(client, cancellationToken);
        }
    }

    private async Task HandleMessageAsync(ClientConnection client, JsonElement root, CancellationToken cancellationToken)
    {
        // 控制协议与游戏数据完全隔离；room.send 的 payload 只作为不透明字符串转发。
        var type = FrameProtocol.RequiredString(root, "type", 32);
        switch (type)
        {
            case "ping":
                await client.SendAsync(new { type = "pong", utc = DateTimeOffset.UtcNow.ToUnixTimeSeconds() }, cancellationToken);
                break;
            case "room.list":
                await SendRoomListAsync(client, cancellationToken);
                break;
            case "room.create":
                await CreateRoomAsync(client, root, cancellationToken);
                break;
            case "room.join":
                await JoinRoomAsync(client, root, cancellationToken);
                break;
            case "room.enter":
                await EnterPublicRoomAsync(client, root, cancellationToken);
                break;
            case "room.info":
                await SendRoomInfoAsync(client, cancellationToken);
                break;
            case "room.send":
                await RelayAsync(client, root, cancellationToken);
                break;
            case "admin.stats":
                await SendAdminStatsAsync(client, root, cancellationToken);
                break;
            case "admin.room.kick":
                await AdminKickAsync(client, root, cancellationToken);
                break;
            case "admin.room.close":
                await AdminCloseRoomAsync(client, root, cancellationToken);
                break;
            case "admin.room.send":
                await AdminSendAsync(client, root, cancellationToken);
                break;
            default:
                throw new ProtocolException("unknown_command", "unknown command");
        }
    }

    private async Task CreateRoomAsync(ClientConnection client, JsonElement root, CancellationToken cancellationToken)
    {
        EnsureNotInRoom(client);
        if (_rooms.Count >= options.MaxRooms) throw new ProtocolException("server_full", "room limit reached");
        var roomId = FrameProtocol.RequiredString(root, "roomId", 48);
        if (!RoomIdPattern().IsMatch(roomId)) throw new ProtocolException("invalid_room_id", "roomId contains invalid characters");
        var roomKey = FrameProtocol.OptionalString(root, "roomKey", 128);
        var roomName = FrameProtocol.OptionalString(root, "roomName", 80);
        var playerName = FrameProtocol.RequiredString(root, "playerName", 64);
        var requestedCapacity = root.TryGetProperty("maxPlayers", out var capacityElement) && capacityElement.TryGetInt32(out var parsed)
            ? parsed : options.MaxPlayersPerRoom;
        var capacity = Math.Clamp(requestedCapacity, 2, options.MaxPlayersPerRoom);
        var room = new Room(roomId, roomKey, roomName, capacity);
        if (!_rooms.TryAdd(roomId, room)) throw new ProtocolException("room_exists", "room already exists");
        if (!room.TryAdd(client, out var peerId))
        {
            _rooms.TryRemove(roomId, out _);
            throw new ProtocolException("server_error", "failed to add room member");
        }
        client.Room = room;
        client.PeerId = peerId;
        client.PlayerName = playerName;
        await client.SendAsync(new { type = "room.ready", protocol = ProtocolVersion, roomId, peerId,
            authorityPeerId = room.AuthorityPeerId, creator = true,
            players = room.Members.Count, capacity }, cancellationToken);
        Console.WriteLine($"room created id={roomId} capacity={capacity}");
    }

    private async Task JoinRoomAsync(ClientConnection client, JsonElement root, CancellationToken cancellationToken)
    {
        EnsureNotInRoom(client);
        var roomId = FrameProtocol.RequiredString(root, "roomId", 48);
        var roomKey = FrameProtocol.OptionalString(root, "roomKey", 128);
        var playerName = FrameProtocol.RequiredString(root, "playerName", 64);
        if (!_rooms.TryGetValue(roomId, out var room) || room.IsClosed)
            throw new ProtocolException("room_not_found", "room was not found");
        if (!FixedEquals(room.Key, roomKey)) throw new ProtocolException("wrong_room_key", "room key is incorrect");
        if (!room.TryAdd(client, out var peerId)) throw new ProtocolException("room_full", "room is full");
        client.Room = room;
        client.PeerId = peerId;
        client.PlayerName = playerName;
        await client.SendAsync(new { type = "room.ready", protocol = ProtocolVersion, roomId, peerId,
            authorityPeerId = room.AuthorityPeerId, creator = false,
            players = room.Members.Count, capacity = room.Capacity }, cancellationToken);
        await BroadcastAsync(room, new { type = "room.playerJoined", peerId, playerName }, client, cancellationToken);
    }

    private async Task EnterPublicRoomAsync(ClientConnection client, JsonElement root, CancellationToken cancellationToken)
    {
        EnsureNotInRoom(client);
        var roomId = FrameProtocol.RequiredString(root, "roomId", 48);
        if (!RoomIdPattern().IsMatch(roomId)) throw new ProtocolException("invalid_room_id", "roomId contains invalid characters");
        if (!_rooms.TryGetValue(roomId, out var room) || room.IsClosed || !room.ServerAuthoritative)
            throw new ProtocolException("unknown_public_room", "public room is not available");
        _ = FrameProtocol.OptionalString(root, "roomName", 80); // 兼容旧客户端字段，公开房间名称由服务器生成。
        var playerName = FrameProtocol.RequiredString(root, "playerName", 64);
        if (room.Key.Length != 0) throw new ProtocolException("private_room", "room requires an explicit key");
        if (!room.TryAdd(client, out var peerId)) throw new ProtocolException("room_full", "room is full");
        // 公开房间的最高权限固定属于服务器（逻辑 Peer 0），所有玩家都是普通参与者。
        client.Room = room;
        client.PeerId = peerId;
        client.PlayerName = playerName;
        await client.SendAsync(new { type = "room.ready", protocol = ProtocolVersion, roomId, peerId,
            authorityPeerId = 0, creator = false, serverAuthority = true,
            players = room.Members.Count, capacity = room.Capacity,
            peerIds = room.Members.Keys.Where(id => id != peerId).OrderBy(id => id).ToArray() }, cancellationToken);
        if (room.Members.Count > 1)
            await BroadcastAsync(room, new { type = "room.playerJoined", peerId, playerName }, client, cancellationToken);
        // 当前房间刚满时立即准备下一个真实房间，下一次列表刷新即可看到。
        _ = EnsureJoinablePublicRoom();
        var roster = room.Members.Values.OrderBy(member => member.PeerId)
            .Select(member => new { peerId = member.PeerId, playerName = member.PlayerName }).ToArray();
        await BroadcastServerPacketAsync(room, new { type = "serverRoster", players = roster }, cancellationToken);
    }

    private async Task RelayAsync(ClientConnection source, JsonElement root, CancellationToken cancellationToken)
    {
        var room = RequireRoom(source);
        var payload = FrameProtocol.RequiredString(root, "payload", 60_000);
        var targetPeerId = root.TryGetProperty("targetPeerId", out var target) && target.TryGetInt64(out var parsed) ? parsed : -1;

        if (room.ServerAuthoritative && targetPeerId == 0)
        {
            JsonObject? packet;
            try { packet = JsonNode.Parse(payload) as JsonObject; }
            catch (JsonException) { throw new ProtocolException("invalid_payload", "public-room payload is invalid JSON"); }
            if (packet is null) throw new ProtocolException("invalid_payload", "public-room payload must be an object");
            var packetType = packet["type"]?.GetValue<string>() ?? string.Empty;
            if (packetType == "worldTime") return; // 玩家不能覆盖服务器权威时钟。
            if (packetType == "serverTimeSeed")
            {
                room.SeedClock(ReadDouble(packet, "gameTime"), ReadInt(packet, "day"),
                    ReadInt(packet, "timeOfDay"), ReadDouble(packet, "timeOffset"));
                return;
            }
            if (packetType == "serverTimeCommit")
            {
                room.CommitApprovedSleep(ReadDouble(packet, "gameTime"), ReadInt(packet, "day"),
                    ReadInt(packet, "timeOfDay"), ReadDouble(packet, "timeOffset"));
                return;
            }
            if (packetType == "serverSceneRequest")
            {
                var expectedScene = packet["expectedScene"]?.GetValue<string>() ?? string.Empty;
                var requestedScene = packet["scene"]?.GetValue<string>() ?? string.Empty;
                if (expectedScene.Length > 128 || requestedScene.Length is 0 or > 128)
                    throw new ProtocolException("invalid_scene", "scene is invalid");
                await BroadcastServerPacketAsync(room, room.RequestScene(expectedScene, requestedScene), cancellationToken);
                return;
            }
            if (packetType == "sleepRequest")
            {
                var mode = packet["mode"]?.GetValue<string>() ?? string.Empty;
                if (mode is not ("short" or "tomorrow"))
                    throw new ProtocolException("invalid_sleep_mode", "sleep mode is invalid");
                var approval = room.RequestSleep(source.PeerId, mode);
                if (approval is not null) await BroadcastServerPacketAsync(room, approval, cancellationToken);
                return;
            }
            if (packetType is "playerState" or "playerLiveData" or "playerProfile")
            {
                packet["ownerId"] = source.PeerId; // 服务端覆盖来源，玩家不能冒充其他成员。
                packet["playerName"] = source.PlayerName;
            }
            if (packetType == "playerState" && packet["position"] is JsonObject position)
            {
                var scene = packet["scene"]?.GetValue<string>() ?? string.Empty;
                source.ObservePosition(ReadDouble(position, "x"), ReadDouble(position, "y"),
                    ReadDouble(position, "z"), scene);
            }
            payload = packet.ToJsonString();
            await BroadcastAsync(room, new { type = "room.message", sourcePeerId = source.PeerId, payload }, source, cancellationToken);
            return;
        }
        var message = new { type = "room.message", sourcePeerId = source.PeerId, payload };

        if (targetPeerId >= 0)
        {
            var destination = room.Members.GetValueOrDefault(targetPeerId);
            if (destination is null) throw new ProtocolException("peer_not_found", "target peer was not found");
            await destination.SendAsync(message, cancellationToken);
            return;
        }

        var destinations = room.Members.Values.Where(item => item != source).ToArray();
        await Task.WhenAll(destinations.Select(item => item.SendAsync(message, cancellationToken)));
    }

    private async Task AdminKickAsync(ClientConnection requester, JsonElement root, CancellationToken cancellationToken)
    {
        RequireAdmin(root);
        var roomId = FrameProtocol.RequiredString(root, "roomId", 48);
        if (!_rooms.TryGetValue(roomId, out var room)) throw new ProtocolException("room_not_found", "room was not found");
        if (!root.TryGetProperty("peerId", out var peerElement) || !peerElement.TryGetInt64(out var peerId) || peerId <= 0)
            throw new ProtocolException("invalid_request", "peerId is invalid");
        if (!room.TryRemove(peerId, out var target) || target is null)
            throw new ProtocolException("peer_not_found", "peer was not found");
        target.Room = null;
        await TrySendAsync(target, new { type = "room.kicked", roomId = room.Id }, cancellationToken);
        target.Client.Dispose();
        if (peerId == room.AuthorityPeerId)
        {
            await RemoveRoomAsync(room, "authority_kicked", cancellationToken);
            await requester.SendAsync(new { type = "admin.ok", command = "admin.room.kick", roomId, peerId }, cancellationToken);
            return;
        }
        await BroadcastAsync(room, new { type = "room.playerLeft", peerId }, null, cancellationToken);
        await requester.SendAsync(new { type = "admin.ok", command = "admin.room.kick", roomId, peerId }, cancellationToken);
    }

    private async Task AdminCloseRoomAsync(ClientConnection requester, JsonElement root, CancellationToken cancellationToken)
    {
        RequireAdmin(root);
        var roomId = FrameProtocol.RequiredString(root, "roomId", 48);
        if (!_rooms.TryGetValue(roomId, out var room)) throw new ProtocolException("room_not_found", "room was not found");
        await requester.SendAsync(new { type = "admin.ok", command = "admin.room.close", roomId }, cancellationToken);
        await RemoveRoomAsync(room, "server_closed", cancellationToken);
    }

    private async Task AdminSendAsync(ClientConnection requester, JsonElement root, CancellationToken cancellationToken)
    {
        RequireAdmin(root);
        var roomId = FrameProtocol.RequiredString(root, "roomId", 48);
        var payload = FrameProtocol.RequiredString(root, "payload", 60_000);
        if (!_rooms.TryGetValue(roomId, out var room)) throw new ProtocolException("room_not_found", "room was not found");
        var targetPeerId = root.TryGetProperty("targetPeerId", out var target) && target.TryGetInt64(out var parsed) ? parsed : -1;
        var message = new { type = "room.serverMessage", payload };
        if (targetPeerId >= 1)
        {
            if (!room.Members.TryGetValue(targetPeerId, out var member))
                throw new ProtocolException("peer_not_found", "target peer was not found");
            await member.SendAsync(message, cancellationToken);
        }
        else await BroadcastAsync(room, message, null, cancellationToken);
        await requester.SendAsync(new { type = "admin.ok", command = "admin.room.send", roomId, targetPeerId }, cancellationToken);
    }

    private async Task SendRoomListAsync(ClientConnection client, CancellationToken cancellationToken)
    {
        _ = EnsureJoinablePublicRoom();
        var rooms = _rooms.Values
            .Where(room => room.ServerAuthoritative && !room.IsClosed)
            .OrderBy(room => PublicRoomNumber(room.Id))
            .Select(room => new { roomId = room.Id, roomName = room.Name,
                players = room.Members.Count, capacity = room.Capacity })
            .ToArray();
        await client.SendAsync(new { type = "room.list", rooms }, cancellationToken);
    }

    private Room? EnsureJoinablePublicRoom()
    {
        lock (_publicRoomsLock)
        {
            var available = _rooms.Values
                .Where(room => room.ServerAuthoritative && !room.IsClosed && room.Members.Count < room.Capacity)
                .OrderBy(room => PublicRoomNumber(room.Id))
                .FirstOrDefault();
            if (available is not null) return available;
            if (_rooms.Count >= options.MaxRooms) return null;

            while (_rooms.Count < options.MaxRooms)
            {
                var number = ++_nextPublicRoomNumber;
                var roomId = $"public-{number}";
                var room = new Room(roomId, string.Empty, $"Public Room {number}",
                    options.MaxPlayersPerRoom, serverAuthoritative: true);
                if (!_rooms.TryAdd(roomId, room)) continue;
                Console.WriteLine($"public room created id={roomId} capacity={room.Capacity}");
                return room;
            }
            return null;
        }
    }

    private void RecycleEmptyPublicRooms()
    {
        lock (_publicRoomsLock)
        {
            var emptyRooms = _rooms.Values
                .Where(room => room.ServerAuthoritative && !room.IsClosed && room.Members.IsEmpty)
                .OrderBy(room => PublicRoomNumber(room.Id))
                .ToArray();
            // 始终保留编号最小的一个空房间供新玩家加入，其余空分片立即回收。
            foreach (var room in emptyRooms.Skip(1))
                if (_rooms.TryRemove(room.Id, out var removed)) removed.Close();
        }
        _ = EnsureJoinablePublicRoom();
    }

    private static int PublicRoomNumber(string roomId) =>
        int.TryParse(roomId.AsSpan(roomId.LastIndexOf('-') + 1), out var number) ? number : int.MaxValue;

    private async Task SendRoomInfoAsync(ClientConnection client, CancellationToken cancellationToken)
    {
        var room = RequireRoom(client);
        var players = room.Members.Values
            .OrderBy(item => item.PeerId).Select(item => new { peerId = item.PeerId, playerName = item.PlayerName }).ToArray();
        await client.SendAsync(new { type = "room.info", roomId = room.Id, roomName = room.Name, capacity = room.Capacity, players }, cancellationToken);
    }

    private async Task SendAdminStatsAsync(ClientConnection client, JsonElement root, CancellationToken cancellationToken)
    {
        RequireAdmin(root);
        await client.SendAsync(new
        {
            type = "admin.stats",
            rooms = _rooms.Count,
            players = _rooms.Values.Sum(room => room.Members.Count),
            startedUtc = Program.StartedUtc
        }, cancellationToken);
    }

    private async Task LeaveRoomAsync(ClientConnection client, CancellationToken cancellationToken)
    {
        var room = client.Room;
        if (room is null) return;
        client.Room = null;
        if (!room.TryRemove(client.PeerId, out _)) return;
        if (room.ServerAuthoritative)
        {
            await BroadcastAsync(room, new { type = "room.playerLeft", peerId = client.PeerId }, null, cancellationToken);
            RecycleEmptyPublicRooms();
            return;
        }
        // 游戏时间和场景以创建者为权威。创建者离开后关闭房间，避免剩余玩家进入分裂世界。
        if (client.PeerId == room.AuthorityPeerId)
        {
            await RemoveRoomAsync(room, "authority_left", cancellationToken);
            return;
        }
        await BroadcastAsync(room, new { type = "room.playerLeft", peerId = client.PeerId }, null, cancellationToken);
    }

    private async Task RemoveRoomAsync(Room room, string reason, CancellationToken cancellationToken)
    {
        if (!_rooms.TryRemove(room.Id, out _)) return;
        room.Close();
        var members = room.Members.Values.ToArray();
        foreach (var member in members)
        {
            member.Room = null;
            await TrySendAsync(member, new { type = "room.closed", roomId = room.Id, reason }, cancellationToken);
            member.Client.Dispose();
        }
        room.Members.Clear();
        Console.WriteLine($"room closed id={room.Id} reason={reason}");
    }

    private static Room RequireRoom(ClientConnection client) =>
        client.Room ?? throw new ProtocolException("not_in_room", "client has not joined a room");

    private void RequireAdmin(JsonElement root)
    {
        var supplied = FrameProtocol.OptionalString(root, "token", 256);
        if (options.AdminToken.Length == 0 || !FixedEquals(options.AdminToken, supplied))
            throw new ProtocolException("forbidden", "admin token is invalid");
    }

    private static void EnsureNotInRoom(ClientConnection client)
    {
        if (client.Room is not null) throw new ProtocolException("already_in_room", "client is already in a room");
    }

    private static bool FixedEquals(string expected, string supplied)
    {
        var left = Encoding.UTF8.GetBytes(expected);
        var right = Encoding.UTF8.GetBytes(supplied);
        return left.Length == right.Length && CryptographicOperations.FixedTimeEquals(left, right);
    }

    private static async Task TrySendAsync(ClientConnection client, object value, CancellationToken cancellationToken)
    {
        try { await client.SendAsync(value, cancellationToken); }
        catch (Exception exception) when (exception is IOException or SocketException or ObjectDisposedException or OperationCanceledException) { }
    }

    private static async Task BroadcastAsync(
        Room room, object value, ClientConnection? excluded, CancellationToken cancellationToken)
    {
        var destinations = room.Members.Values.Where(member => member != excluded).ToArray();
        await Task.WhenAll(destinations.Select(member => TrySendAsync(member, value, cancellationToken)));
    }

    private async Task RunAuthoritativeClockAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(200));
        while (await timer.WaitForNextTickAsync(cancellationToken))
        {
            foreach (var room in _rooms.Values.Where(item => item.ServerAuthoritative && !item.IsClosed))
            {
                var packet = room.CreateClockPacket();
                if (packet is not null) await BroadcastServerPacketAsync(room, packet, cancellationToken);
            }
        }
    }

    private async Task RunClientTimeoutsAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(ClientTimeoutCheckInterval);
        while (await timer.WaitForNextTickAsync(cancellationToken))
        {
            var now = DateTime.UtcNow;
            foreach (var client in _clients.Keys)
            {
                var reason = client.TryBeginInactivityTimeout(now, TimeSpan.FromSeconds(options.ClientTimeoutSeconds))
                    ? "TCP inactivity"
                    : client.Room is not null && client.TryBeginAfkTimeout(now, TimeSpan.FromSeconds(options.AfkTimeoutSeconds))
                        ? "AFK position"
                        : string.Empty;
                if (reason.Length == 0) continue;
                var roomId = client.Room?.Id ?? "none";
                Console.WriteLine($"client timed out reason={reason} room={roomId} peer={client.PeerId}");
                // 关闭套接字会中断 ReadJsonAsync，随后统一进入 finally -> LeaveRoomAsync。
                try { client.Client.Dispose(); } catch { }
            }
        }
    }

    private static Task BroadcastServerPacketAsync(Room room, object packet, CancellationToken cancellationToken) =>
        BroadcastAsync(room, new { type = "room.message", sourcePeerId = 0,
            payload = JsonSerializer.Serialize(packet) }, null, cancellationToken);

    private static double ReadDouble(JsonObject packet, string name) =>
        packet[name]?.GetValue<double>() is double value && double.IsFinite(value) ? value : 0;

    private static int ReadInt(JsonObject packet, string name) =>
        packet[name]?.GetValue<int>() is int value ? value : 0;

    private static void Configure(TcpClient client)
    {
        client.NoDelay = true;
        client.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.KeepAlive, true);
    }

    public ValueTask DisposeAsync()
    {
        Stop();
        _shutdown.Dispose();
        return ValueTask.CompletedTask;
    }
}
