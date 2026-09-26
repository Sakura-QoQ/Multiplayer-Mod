using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;

namespace FallenFlower.MultiplayerBridge;

public static class NativeExports
{
    // 整个游戏进程只保留一个网络节点；场景重载不会主动销毁它。
    private static readonly BridgeNode Node = new();
    private static readonly object PollLock = new();
    private static string? _pendingEvent;

    [UnmanagedCallersOnly(EntryPoint = "mpb_host", CallConvs = [typeof(CallConvCdecl)])]
    public static int Host(int port, int maxClients) => Node.StartHost(port, maxClients);

    [UnmanagedCallersOnly(EntryPoint = "mpb_join", CallConvs = [typeof(CallConvCdecl)])]
    public static int Join(nint hostUtf8, int port)
    {
        var host = Marshal.PtrToStringUTF8(hostUtf8);
        return host is null ? -1 : Node.Join(host, port);
    }

    [UnmanagedCallersOnly(EntryPoint = "mpb_send", CallConvs = [typeof(CallConvCdecl)])]
    public static int Send(long peerId, nint messageUtf8)
    {
        var message = Marshal.PtrToStringUTF8(messageUtf8);
        return message is null ? -1 : Node.Send(peerId, message);
    }

    [UnmanagedCallersOnly(EntryPoint = "mpb_poll_event", CallConvs = [typeof(CallConvCdecl)])]
    public static int PollEvent(nint destination, int capacity)
    {
        // 调用方可以先传入小缓冲区。返回负数表示包含 NUL 结尾符在内所需的容量。
        lock (PollLock)
        {
            if (_pendingEvent is null)
            {
                if (!Node.TryPoll(out var bridgeEvent))
                {
                    return 0;
                }
                _pendingEvent = bridgeEvent.ToJson();
            }

            var bytes = Encoding.UTF8.GetBytes(_pendingEvent);
            var required = bytes.Length + 1;
            if (destination == 0 || capacity < required)
            {
                return -required;
            }

            Marshal.Copy(bytes, 0, destination, bytes.Length);
            Marshal.WriteByte(destination, bytes.Length, 0);
            _pendingEvent = null;
            return bytes.Length;
        }
    }

    [UnmanagedCallersOnly(EntryPoint = "mpb_status", CallConvs = [typeof(CallConvCdecl)])]
    public static int Status(nint destination, int capacity)
    {
        // 状态使用短 JSON 返回，便于 TypeScript 在场景重载后接管原连接。
        var json = $"{{\"state\":\"{Node.State}\",\"port\":{Node.BoundPort},\"peers\":{Node.PeerCount}}}";
        var bytes = Encoding.UTF8.GetBytes(json);
        var required = bytes.Length + 1;
        if (destination == 0 || capacity < required)
        {
            return -required;
        }

        Marshal.Copy(bytes, 0, destination, bytes.Length);
        Marshal.WriteByte(destination, bytes.Length, 0);
        return bytes.Length;
    }

    [UnmanagedCallersOnly(EntryPoint = "mpb_stop", CallConvs = [typeof(CallConvCdecl)])]
    public static void Stop() => Node.Stop();

    [UnmanagedCallersOnly(EntryPoint = "mpb_protocol_version", CallConvs = [typeof(CallConvCdecl)])]
    public static int ProtocolVersion() => 1;
}
