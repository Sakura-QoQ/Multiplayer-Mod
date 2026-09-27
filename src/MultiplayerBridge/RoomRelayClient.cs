using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace FallenFlower.MultiplayerBridge;

// 把独立房间服务器协议适配成游戏脚本已经使用的房主/客户端事件模型。
public sealed class RoomRelayClient : IDisposable
{
    private const int MaxFrameBytes = 64 * 1024;
    private const int MaxQueuedEvents = 1024;
    private readonly object _lifecycleLock = new();
    private readonly ConcurrentQueue<BridgeEvent> _events = new();
    private CancellationTokenSource? _cancellation;
    private TcpClient? _client;
    private SemaphoreSlim? _sendLock;
    private Task? _worker;
    private int _queuedEvents;
    private string _state = "stopped";
    private bool _isAuthority;
    private string _entryMode = "join";
    private long _localPeerId;
    private long _authorityPeerId;
    private int _memberCount;

    public string State => Volatile.Read(ref _state);
    public int RemotePort { get; private set; }
    public int PeerCount => Math.Max(0, Volatile.Read(ref _memberCount) - 1);
    public long LocalPeerId => Interlocked.Read(ref _localPeerId);
    public long AuthorityPeerId => Interlocked.Read(ref _authorityPeerId);
    public bool IsRunning => _cancellation is not null;

    public int Start(string host, int port, bool createRoom, string roomId, string roomKey,
        string roomName, string playerName, int maxPlayers)
        => StartCore(host, port, createRoom ? "create" : "join", roomId, roomKey,
            roomName, playerName, maxPlayers);

    public int EnterPublicRoom(string host, int port, string roomId, string playerName, int maxPlayers)
        => StartCore(host, port, "enter", roomId, string.Empty, roomId, playerName, maxPlayers);

    private int StartCore(string host, int port, string entryMode, string roomId, string roomKey,
        string roomName, string playerName, int maxPlayers)
    {
        if (string.IsNullOrWhiteSpace(host) || port is < 1 or > 65535 ||
            string.IsNullOrWhiteSpace(roomId) || roomId.Length > 48 ||
            string.IsNullOrWhiteSpace(playerName) || playerName.Length > 64 ||
            roomKey.Length > 128 || roomName.Length > 80 || maxPlayers is < 2 or > 32)
            return Fail("invalid room-server options");

        lock (_lifecycleLock)
        {
            if (_cancellation is not null) return Fail("room relay is already running");
            _cancellation = new CancellationTokenSource();
            _entryMode = entryMode;
            _isAuthority = entryMode == "create";
            RemotePort = port;
            Volatile.Write(ref _state, "connecting");
            _worker = Task.Run(() => ConnectAsync(host, port, roomId, roomKey, roomName,
                playerName, maxPlayers, _cancellation.Token));
            return 0;
        }
    }

    public int Send(long logicalPeerId, string payload)
    {
        if (State is not ("hosting" or "connected") || _client is null)
            return Fail("room relay is not connected");
        if (Encoding.UTF8.GetByteCount(payload ?? string.Empty) > 60_000)
            return Fail("message exceeds 60000 bytes");

        string command;
        if (_isAuthority)
        {
            command = logicalPeerId == 0
                ? "{\"type\":\"room.send\",\"payload\":" + Quote(payload) + "}"
                : "{\"type\":\"room.send\",\"targetPeerId\":" + logicalPeerId +
                    ",\"payload\":" + Quote(payload) + "}";
        }
        else
        {
            var target = logicalPeerId == 0 ? AuthorityPeerId : logicalPeerId;
            command = "{\"type\":\"room.send\",\"targetPeerId\":" + target +
                ",\"payload\":" + Quote(payload) + "}";
        }
        QueueSend(command);
        return 0;
    }

    public bool TryPoll(out BridgeEvent bridgeEvent)
    {
        if (_events.TryDequeue(out bridgeEvent))
        {
            Interlocked.Decrement(ref _queuedEvents);
            return true;
        }
        bridgeEvent = default;
        return false;
    }

    public void Stop()
    {
        lock (_lifecycleLock)
        {
            var cancellation = _cancellation;
            _cancellation = null;
            cancellation?.Cancel();
            _client?.Dispose();
            _client = null;
            _sendLock?.Dispose();
            _sendLock = null;
            cancellation?.Dispose();
            _worker = null;
            RemotePort = 0;
            Interlocked.Exchange(ref _localPeerId, 0);
            Interlocked.Exchange(ref _authorityPeerId, 0);
            Volatile.Write(ref _memberCount, 0);
            Volatile.Write(ref _state, "stopped");
        }
    }

    private async Task ConnectAsync(string host, int port, string roomId, string roomKey,
        string roomName, string playerName, int maxPlayers, CancellationToken cancellationToken)
    {
        var client = new TcpClient();
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));
            await client.ConnectAsync(host, port, timeout.Token).ConfigureAwait(false);
            client.NoDelay = true;
            client.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.KeepAlive, true);
            _client = client;
            _sendLock = new SemaphoreSlim(1, 1);
            var request = _entryMode == "create"
                ? "{\"type\":\"room.create\",\"roomId\":" + Quote(roomId) +
                    ",\"roomKey\":" + Quote(roomKey) + ",\"roomName\":" + Quote(roomName) +
                    ",\"playerName\":" + Quote(playerName) + ",\"maxPlayers\":" + maxPlayers + "}"
                : _entryMode == "enter"
                    ? "{\"type\":\"room.enter\",\"roomId\":" + Quote(roomId) +
                        ",\"roomName\":" + Quote(roomName) + ",\"playerName\":" + Quote(playerName) +
                        ",\"maxPlayers\":" + maxPlayers + "}"
                    : "{\"type\":\"room.join\",\"roomId\":" + Quote(roomId) +
                    ",\"roomKey\":" + Quote(roomKey) + ",\"playerName\":" + Quote(playerName) + "}";
            await SendFrameAsync(request, cancellationToken).ConfigureAwait(false);
            await ReceiveLoopAsync(client.GetStream(), cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception exception)
        {
            Enqueue(new BridgeEvent("error", 0, exception.Message));
        }
        finally
        {
            client.Dispose();
            Volatile.Write(ref _state, "stopped");
            Enqueue(new BridgeEvent("disconnected", _isAuthority ? LocalPeerId : 0));
        }
    }

    private async Task ReceiveLoopAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            using var document = await ReadFrameAsync(stream, cancellationToken).ConfigureAwait(false);
            var root = document.RootElement;
            var type = root.TryGetProperty("type", out var typeElement) ? typeElement.GetString() ?? string.Empty : string.Empty;
            switch (type)
            {
                case "room.ready":
                    var local = root.GetProperty("peerId").GetInt64();
                    // 兼容首版服务器：该版本按顺序从 1 分配 peerId，房间创建者固定为 1。
                    var authority = root.TryGetProperty("authorityPeerId", out var authorityElement)
                        ? authorityElement.GetInt64() : 1;
                    _isAuthority = root.TryGetProperty("creator", out var creatorElement)
                        ? creatorElement.GetBoolean() : local == authority;
                    Interlocked.Exchange(ref _localPeerId, local);
                    Interlocked.Exchange(ref _authorityPeerId, authority);
                    Volatile.Write(ref _memberCount, root.TryGetProperty("players", out var players) ? players.GetInt32() : 1);
                    Volatile.Write(ref _state, _isAuthority ? "hosting" : "connected");
                    Enqueue(new BridgeEvent("roomReady", local,
                        "{\"localPeerId\":" + local + ",\"authorityPeerId\":" + authority +
                        ",\"creator\":" + (_isAuthority ? "true" : "false") +
                        ",\"serverAuthority\":" + (authority == 0 ? "true" : "false") + "}"));
                    if (!_isAuthority) Enqueue(new BridgeEvent("connected", 0));
                    if (root.TryGetProperty("peerIds", out var peerIds) && peerIds.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var peer in peerIds.EnumerateArray())
                            if (peer.TryGetInt64(out var existingPeer) && existingPeer > 0 && existingPeer != local)
                                Enqueue(new BridgeEvent("connected", existingPeer));
                    }
                    break;
                case "room.playerJoined":
                    Interlocked.Increment(ref _memberCount);
                    if (root.TryGetProperty("peerId", out var joinedPeer))
                        Enqueue(new BridgeEvent("connected", joinedPeer.GetInt64()));
                    break;
                case "room.playerLeft":
                    Volatile.Write(ref _memberCount, Math.Max(1, Volatile.Read(ref _memberCount) - 1));
                    if (root.TryGetProperty("peerId", out var leftPeer))
                    {
                        var source = leftPeer.GetInt64();
                        Enqueue(new BridgeEvent("disconnected", source == AuthorityPeerId ? 0 : source));
                    }
                    break;
                case "room.message":
                    var sourcePeerId = root.GetProperty("sourcePeerId").GetInt64();
                    var logicalSource = sourcePeerId == AuthorityPeerId ? 0 : sourcePeerId;
                    Enqueue(new BridgeEvent("message", logicalSource, root.GetProperty("payload").GetString() ?? string.Empty));
                    break;
                case "room.closed":
                case "room.kicked":
                    Enqueue(new BridgeEvent("error", 0, type));
                    return;
                case "error":
                    var message = root.TryGetProperty("message", out var messageElement)
                        ? messageElement.GetString() ?? "room server error" : "room server error";
                    Enqueue(new BridgeEvent("error", 0, message));
                    return;
            }
        }
    }

    private void QueueSend(string value)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                if (_cancellation is null) return;
                await SendFrameAsync(value, _cancellation.Token).ConfigureAwait(false);
            }
            catch (Exception exception) { Enqueue(new BridgeEvent("error", 0, exception.Message)); }
        });
    }

    private async Task SendFrameAsync(string value, CancellationToken cancellationToken)
    {
        var client = _client ?? throw new IOException("room relay socket is unavailable");
        var sendLock = _sendLock ?? throw new IOException("room relay send lock is unavailable");
        var payload = Encoding.UTF8.GetBytes(value);
        if (payload.Length > MaxFrameBytes) throw new InvalidDataException("frame exceeds room-server limit");
        var header = new byte[4];
        BinaryPrimitives.WriteInt32BigEndian(header, payload.Length);
        await sendLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var stream = client.GetStream();
            await stream.WriteAsync(header, cancellationToken).ConfigureAwait(false);
            await stream.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
            await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
        finally { sendLock.Release(); }
    }

    private static async Task<JsonDocument> ReadFrameAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var header = new byte[4];
        await ReadExactlyAsync(stream, header, cancellationToken).ConfigureAwait(false);
        var length = BinaryPrimitives.ReadInt32BigEndian(header);
        if (length is <= 0 or > MaxFrameBytes) throw new InvalidDataException("invalid room-server frame length");
        var payload = new byte[length];
        await ReadExactlyAsync(stream, payload, cancellationToken).ConfigureAwait(false);
        return JsonDocument.Parse(payload);
    }

    private static async Task ReadExactlyAsync(NetworkStream stream, byte[] buffer, CancellationToken cancellationToken)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset), cancellationToken).ConfigureAwait(false);
            if (read == 0) throw new EndOfStreamException();
            offset += read;
        }
    }

    private int Fail(string message)
    {
        Enqueue(new BridgeEvent("error", 0, message));
        return -1;
    }

    private static string Quote(string? value) =>
        "\"" + JsonEncodedText.Encode(value ?? string.Empty).ToString() + "\"";

    private void Enqueue(BridgeEvent bridgeEvent)
    {
        while (Volatile.Read(ref _queuedEvents) >= MaxQueuedEvents && _events.TryDequeue(out _))
            Interlocked.Decrement(ref _queuedEvents);
        _events.Enqueue(bridgeEvent);
        Interlocked.Increment(ref _queuedEvents);
    }

    public void Dispose()
    {
        Stop();
        GC.SuppressFinalize(this);
    }
}
