using System.Net.Sockets;

namespace FallenFlower.MultiplayerRoomServer;

internal sealed class ClientConnection(TcpClient client) : IAsyncDisposable
{
    // 多个房间成员可能同时向同一连接转发数据；整帧写入必须串行，防止字节交错。
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly object _movementLock = new();
    private long _lastReceivedUtcTicks = DateTime.UtcNow.Ticks;
    private long _lastMovementUtcTicks = DateTime.UtcNow.Ticks;
    private int _timeoutStarted;
    private bool _positionObserved;
    private double _positionX;
    private double _positionY;
    private double _positionZ;
    private string _scene = string.Empty;

    public TcpClient Client { get; } = client;
    public Room? Room { get; set; }
    public long PeerId { get; set; }
    public string PlayerName { get; set; } = string.Empty;

    public void MarkReceived() => Interlocked.Exchange(ref _lastReceivedUtcTicks, DateTime.UtcNow.Ticks);

    public void ObservePosition(double x, double y, double z, string scene)
    {
        // 以 5 cm 作为有效位移阈值，忽略 CharacterController 和浮点插值造成的原地抖动；
        // 坐标从上一次有效位置累计计算，缓慢移动最终也会刷新活动时间。
        const double movementThresholdSquared = 0.05 * 0.05;
        lock (_movementLock)
        {
            var sceneChanged = !string.Equals(_scene, scene, StringComparison.Ordinal);
            var xDelta = x - _positionX;
            var yDelta = y - _positionY;
            var zDelta = z - _positionZ;
            var moved = xDelta * xDelta + yDelta * yDelta + zDelta * zDelta >= movementThresholdSquared;
            if (!_positionObserved || sceneChanged || moved)
            {
                _positionObserved = true;
                _positionX = x;
                _positionY = y;
                _positionZ = z;
                _scene = scene;
                Interlocked.Exchange(ref _lastMovementUtcTicks, DateTime.UtcNow.Ticks);
            }
        }
    }

    public bool TryBeginInactivityTimeout(DateTime utcNow, TimeSpan timeout)
    {
        var idleTicks = utcNow.Ticks - Interlocked.Read(ref _lastReceivedUtcTicks);
        return idleTicks >= timeout.Ticks && TryMarkTimedOut();
    }

    public bool TryBeginAfkTimeout(DateTime utcNow, TimeSpan timeout)
    {
        var idleTicks = utcNow.Ticks - Interlocked.Read(ref _lastMovementUtcTicks);
        return idleTicks >= timeout.Ticks && TryMarkTimedOut();
    }

    private bool TryMarkTimedOut() => Interlocked.CompareExchange(ref _timeoutStarted, 1, 0) == 0;

    public async Task SendAsync(object value, CancellationToken cancellationToken)
    {
        var frame = FrameProtocol.Serialize(value);
        await _sendLock.WaitAsync(cancellationToken);
        try
        {
            var stream = Client.GetStream();
            await stream.WriteAsync(frame, cancellationToken);
            await stream.FlushAsync(cancellationToken);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    public ValueTask DisposeAsync()
    {
        Client.Dispose();
        _sendLock.Dispose();
        return ValueTask.CompletedTask;
    }
}
