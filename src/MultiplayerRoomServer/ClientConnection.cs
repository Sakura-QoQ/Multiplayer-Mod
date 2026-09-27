using System.Net.Sockets;

namespace FallenFlower.MultiplayerRoomServer;

internal sealed class ClientConnection(TcpClient client) : IAsyncDisposable
{
    // 多个房间成员可能同时向同一连接转发数据；整帧写入必须串行，防止字节交错。
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    public TcpClient Client { get; } = client;
    public Room? Room { get; set; }
    public long PeerId { get; set; }
    public string PlayerName { get; set; } = string.Empty;

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
