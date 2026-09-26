using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace FallenFlower.MultiplayerBridge;

public sealed class BridgeNode : IDisposable
{
    // 限制单条消息和待处理事件数量，避免异常客户端无限占用内存。
    private const int MaxPayloadBytes = 64 * 1024;
    private const int MaxQueuedEvents = 1024;
    private readonly object _lifecycleLock = new();
    private readonly ConcurrentDictionary<long, Connection> _peers = new();
    private readonly ConcurrentQueue<BridgeEvent> _events = new();
    private CancellationTokenSource? _cancellation;
    private TcpListener? _listener;
    private Connection? _server;
    private Task? _worker;
    private int _queuedEvents;
    private long _nextPeerId;
    private int _maxClients;
    private string _state = "stopped";

    public string State => Volatile.Read(ref _state);
    public int BoundPort { get; private set; }
    public int PeerCount => State == "hosting" ? _peers.Count : (_server is null ? 0 : 1);

    public int StartHost(int port, int maxClients)
    {
        if (port is < 0 or > 65535 || maxClients is < 1 or > 32)
        {
            return Fail("invalid host options");
        }

        lock (_lifecycleLock)
        {
            if (_cancellation is not null)
            {
                return Fail("bridge is already running");
            }

            try
            {
                _cancellation = new CancellationTokenSource();
                _maxClients = maxClients;
                // 监听所有本机网卡，使局域网或端口转发后的玩家能够连接。
                _listener = new TcpListener(IPAddress.Any, port);
                _listener.Start(maxClients);
                BoundPort = ((IPEndPoint)_listener.LocalEndpoint).Port;
                Volatile.Write(ref _state, "hosting");
                Enqueue(new BridgeEvent("listening", 0, BoundPort.ToString()));
                _worker = Task.Run(() => AcceptLoopAsync(_cancellation.Token));
                return 0;
            }
            catch (Exception exception)
            {
                CleanupLocked();
                return Fail(exception.Message);
            }
        }
    }

    public int Join(string host, int port)
    {
        if (string.IsNullOrWhiteSpace(host) || port is < 1 or > 65535)
        {
            return Fail("invalid join options");
        }

        lock (_lifecycleLock)
        {
            if (_cancellation is not null)
            {
                return Fail("bridge is already running");
            }

            _cancellation = new CancellationTokenSource();
            Volatile.Write(ref _state, "connecting");
            _worker = Task.Run(() => ConnectAsync(host, port, _cancellation.Token));
            return 0;
        }
    }

    public int Send(long peerId, string message)
    {
        var payload = Encoding.UTF8.GetBytes(message ?? string.Empty);
        if (payload.Length > MaxPayloadBytes)
        {
            return Fail($"message exceeds {MaxPayloadBytes} bytes");
        }

        if (State == "hosting")
        {
            // 房主发送给 peerId=0 时表示广播；非零值表示指定客户端。
            if (peerId == 0)
            {
                foreach (var connection in _peers.Values)
                {
                    QueueSend(connection, payload);
                }
                return 0;
            }

            if (!_peers.TryGetValue(peerId, out var peer))
            {
                return Fail("peer not found");
            }

            QueueSend(peer, payload);
            return 0;
        }

        var server = _server;
        if (State == "connected" && server is not null)
        {
            QueueSend(server, payload);
            return 0;
        }

        return Fail("bridge is not connected");
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
            CleanupLocked();
        }
    }

    private async Task AcceptLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var tcpClient = await _listener!.AcceptTcpClientAsync(cancellationToken).ConfigureAwait(false);
                Configure(tcpClient);
                if (_peers.Count >= _maxClients)
                {
                    tcpClient.Dispose();
                    continue;
                }

                var peerId = Interlocked.Increment(ref _nextPeerId);
                var connection = new Connection(tcpClient);
                if (!_peers.TryAdd(peerId, connection))
                {
                    connection.Dispose();
                    continue;
                }

                Enqueue(new BridgeEvent("connected", peerId));
                _ = Task.Run(() => ReceiveLoopAsync(peerId, connection, cancellationToken));
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (ObjectDisposedException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            Enqueue(new BridgeEvent("error", 0, exception.Message));
        }
    }

    private async Task ConnectAsync(string host, int port, CancellationToken cancellationToken)
    {
        var tcpClient = new TcpClient();
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            // 防止错误地址让连接任务无限等待。
            timeout.CancelAfter(TimeSpan.FromSeconds(8));
            await tcpClient.ConnectAsync(host, port, timeout.Token).ConfigureAwait(false);
            Configure(tcpClient);
            var connection = new Connection(tcpClient);
            _server = connection;
            Volatile.Write(ref _state, "connected");
            Enqueue(new BridgeEvent("connected", 1));
            await ReceiveLoopAsync(1, connection, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            tcpClient.Dispose();
        }
        catch (Exception exception)
        {
            tcpClient.Dispose();
            Volatile.Write(ref _state, "stopped");
            Enqueue(new BridgeEvent("error", 0, exception.Message));
        }
    }

    private async Task ReceiveLoopAsync(long peerId, Connection connection, CancellationToken cancellationToken)
    {
        try
        {
            var stream = connection.Client.GetStream();
            var header = new byte[4];
            while (!cancellationToken.IsCancellationRequested)
            {
                await ReadExactlyAsync(stream, header, cancellationToken).ConfigureAwait(false);
                // TCP 没有消息边界：每帧先读取 4 字节大端长度，再读取对应的 UTF-8 JSON 内容。
                var length = BinaryPrimitives.ReadInt32BigEndian(header);
                if (length is < 0 or > MaxPayloadBytes)
                {
                    throw new InvalidDataException("invalid frame length");
                }

                var payload = new byte[length];
                await ReadExactlyAsync(stream, payload, cancellationToken).ConfigureAwait(false);
                Enqueue(new BridgeEvent("message", peerId, Encoding.UTF8.GetString(payload)));
            }
        }
        catch (EndOfStreamException)
        {
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (ObjectDisposedException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            Enqueue(new BridgeEvent("error", peerId, exception.Message));
        }
        finally
        {
            connection.Dispose();
            if (State == "hosting")
            {
                _peers.TryRemove(peerId, out _);
            }
            else if (ReferenceEquals(_server, connection))
            {
                _server = null;
                Volatile.Write(ref _state, "stopped");
            }
            Enqueue(new BridgeEvent("disconnected", peerId));
        }
    }

    private void QueueSend(Connection connection, byte[] payload)
    {
        // 每条连接单独串行写入，避免多个异步发送互相交叉破坏帧边界。
        _ = Task.Run(async () =>
        {
            try
            {
                await connection.SendLock.WaitAsync().ConfigureAwait(false);
                try
                {
                    var header = new byte[4];
                    BinaryPrimitives.WriteInt32BigEndian(header, payload.Length);
                    var stream = connection.Client.GetStream();
                    await stream.WriteAsync(header).ConfigureAwait(false);
                    await stream.WriteAsync(payload).ConfigureAwait(false);
                    await stream.FlushAsync().ConfigureAwait(false);
                }
                finally
                {
                    connection.SendLock.Release();
                }
            }
            catch (Exception exception)
            {
                Enqueue(new BridgeEvent("error", 0, exception.Message));
            }
        });
    }

    private static async Task ReadExactlyAsync(NetworkStream stream, byte[] buffer, CancellationToken cancellationToken)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset), cancellationToken).ConfigureAwait(false);
            if (read == 0)
            {
                throw new EndOfStreamException();
            }
            offset += read;
        }
    }

    private static void Configure(TcpClient client)
    {
        client.NoDelay = true;
        client.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.KeepAlive, true);
    }

    private int Fail(string message)
    {
        Enqueue(new BridgeEvent("error", 0, message));
        return -1;
    }

    private void Enqueue(BridgeEvent bridgeEvent)
    {
        // 队列到达上限时丢弃最旧事件，让游戏仍能收到最新网络状态。
        while (Volatile.Read(ref _queuedEvents) >= MaxQueuedEvents && _events.TryDequeue(out _))
        {
            Interlocked.Decrement(ref _queuedEvents);
        }
        _events.Enqueue(bridgeEvent);
        Interlocked.Increment(ref _queuedEvents);
    }

    private void CleanupLocked()
    {
        var cancellation = _cancellation;
        _cancellation = null;
        cancellation?.Cancel();
        _listener?.Stop();
        _listener = null;
        _server?.Dispose();
        _server = null;
        foreach (var connection in _peers.Values)
        {
            connection.Dispose();
        }
        _peers.Clear();
        cancellation?.Dispose();
        _worker = null;
        BoundPort = 0;
        Volatile.Write(ref _state, "stopped");
    }

    public void Dispose()
    {
        Stop();
        GC.SuppressFinalize(this);
    }

    private sealed class Connection : IDisposable
    {
        public Connection(TcpClient client) => Client = client;
        public TcpClient Client { get; }
        public SemaphoreSlim SendLock { get; } = new(1, 1);

        public void Dispose()
        {
            Client.Dispose();
            SendLock.Dispose();
        }
    }
}
